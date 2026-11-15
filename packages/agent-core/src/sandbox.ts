/**
 * Ejecución de código en un contenedor Docker efímero y aislado (proyecto 13).
 *
 * Modelo de amenazas: el código que corre acá lo escribió (o lo eligió) un LLM, que
 * puede estar comprometido por prompt injection. Se asume hostil. El contenedor:
 *  - no tiene red (--network none): no puede exfiltrar datos ni bajar nada;
 *  - no recibe ninguna variable de entorno del host: no ve OPENAI_API_KEY ni ningún secreto;
 *  - solo ve la carpeta de trabajo (montada en /workspace); el resto del filesystem es de solo lectura;
 *  - corre como usuario sin privilegios, sin capabilities y sin poder escalar (no-new-privileges);
 *  - tiene límites de memoria, CPU, procesos (contra fork bombs) y tiempo.
 * Docker comparte el kernel con el host: para código de terceros a escala conviene una
 * microVM (Firecracker, gVisor). Para un agente de desarrollo, esto es un buen equilibrio.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveInside } from "./fsTools.js";
import { requireString, type AgentTool } from "./tools.js";

export const SANDBOX_IMAGE = process.env.AGENT_SANDBOX_IMAGE ?? "agentic-sandbox:latest";

export interface SandboxOptions {
  /** Carpeta del host montada en /workspace (la única escribible). */
  workspaceDir: string;
  image?: string;
  timeoutMs?: number;
  /** Memoria máxima (sin swap extra), ej: "512m". */
  memory?: string;
  cpus?: number;
  pidsLimit?: number;
  /** Variables de entorno EXPLÍCITAS para el contenedor (nunca se hereda el entorno del host). */
  env?: Record<string, string>;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** true si el kernel lo mató por superar la memoria (exit 137 sin timeout). */
  oomKilled: boolean;
  durationMs: number;
}

export type Exec = (file: string, args: string[], options: { timeout?: number; maxBuffer?: number }) => Promise<{ code: number | null; stdout: string; stderr: string; killed: boolean }>;

export const execFileAsync: Exec = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, { ...options, env: { PATH: process.env.PATH ?? "" } }, (error: any, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout: String(stdout), stderr: String(stderr), killed: Boolean(error?.killed) });
    });
  });

/** Los argumentos de `docker run` (función pura: así se testea sin Docker). */
export function dockerRunArgs(name: string, command: string[], { workspaceDir, image = SANDBOX_IMAGE, memory = "512m", cpus = 1, pidsLimit = 128, env = {} }: SandboxOptions): string[] {
  return [
    "run", "--rm", "--name", name,
    "--network", "none",
    "--memory", memory, "--memory-swap", memory,
    "--cpus", String(cpus),
    "--pids-limit", String(pidsLimit),
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--user", "1000:1000",
    "-v", `${path.resolve(workspaceDir)}:/workspace:rw`,
    "-w", "/workspace",
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    image,
    ...command,
  ];
}

/** Corre un comando en un contenedor nuevo. Nunca lanza por el resultado del comando: lo devuelve. */
export async function runInSandbox(command: string[], options: SandboxOptions, exec: Exec = execFileAsync): Promise<SandboxResult> {
  const name = `agent-sbx-${randomUUID().slice(0, 12)}`;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const started = Date.now();
  const timer = setTimeout(() => void exec("docker", ["kill", name], {}), timeoutMs);
  try {
    const r = await exec("docker", dockerRunArgs(name, command, options), { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs + 10_000 });
    const timedOut = Date.now() - started >= timeoutMs || r.killed;
    return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr, timedOut, oomKilled: r.code === 137 && !timedOut, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** ¿Está disponible el daemon de Docker? */
export async function dockerAvailable(exec: Exec = execFileAsync): Promise<boolean> {
  return (await exec("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 })).code === 0;
}

/** Corre Vitest sobre un archivo de tests DENTRO del sandbox (la imagen trae vitest para Linux). */
export async function runVitestInSandbox(workspaceDir: string, testFile: string, timeoutMs = 60_000, exec?: Exec) {
  const relative = path.relative(workspaceDir, await resolveInside(workspaceDir, testFile));
  const r = await runInSandbox(["vitest", "run", relative, "--reporter=verbose", "--color=false"], { workspaceDir, timeoutMs, env: { CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" } }, exec);
  // Sin códigos de color: esta salida la lee un LLM.
  const output = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "").trim();
  return { passed: r.exitCode === 0, exitCode: r.exitCode, timedOut: r.timedOut, output };
}

/** Tool para agentes: ejecutar un comando de shell dentro del sandbox. */
export function createSandboxTool({ workspaceDir, timeoutMs }: { workspaceDir: string; timeoutMs?: number }): AgentTool {
  return {
    name: "run_in_sandbox",
    description: "Ejecuta un comando de shell en un contenedor aislado (sin red ni secretos) con tu carpeta de trabajo en /workspace. Devuelve exit code, stdout y stderr.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false },
    async execute(args) {
      const r = await runInSandbox(["sh", "-c", requireString(args, "command")], { workspaceDir, timeoutMs });
      const status = r.timedOut ? "TIMEOUT" : r.oomKilled ? "SIN MEMORIA (OOM)" : `exit ${r.exitCode}`;
      return `${status} en ${r.durationMs} ms\n--- stdout ---\n${r.stdout.slice(-8000)}\n--- stderr ---\n${r.stderr.slice(-4000)}`;
    },
  };
}
