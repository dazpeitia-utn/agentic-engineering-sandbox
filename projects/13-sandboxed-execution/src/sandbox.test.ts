/** Tests sin Docker: los argumentos de aislamiento y el manejo de resultados. */
import { describe, expect, it, vi } from "vitest";
import { createSandboxTool, dockerRunArgs, runInSandbox, runVitestInSandbox } from "@sandbox/agent-core";

describe("argumentos de docker run", () => {
  const args = dockerRunArgs("sbx-1", ["node", "-v"], { workspaceDir: "/tmp/ws", env: { CI: "1" } });
  const value = (flag: string) => args[args.indexOf(flag) + 1];

  it("aísla red, filesystem, usuario y capabilities", () => {
    expect(value("--network")).toBe("none");
    expect(args).toContain("--read-only");
    expect(value("--cap-drop")).toBe("ALL");
    expect(value("--security-opt")).toBe("no-new-privileges");
    expect(value("--user")).toBe("1000:1000");
    expect(value("-v")).toBe("/tmp/ws:/workspace:rw");
  });

  it("limita memoria (sin swap extra), CPU y procesos", () => {
    expect(value("--memory")).toBe("512m");
    expect(value("--memory-swap")).toBe("512m");
    expect(value("--cpus")).toBe("1");
    expect(value("--pids-limit")).toBe("128");
  });

  it("solo pasa las variables de entorno explícitas, y el comando va después de la imagen", () => {
    expect(args.filter((a) => a === "-e")).toHaveLength(1);
    expect(value("-e")).toBe("CI=1");
    expect(args.slice(-3)).toEqual(["agentic-sandbox:latest", "node", "-v"]);
  });
});

describe("runInSandbox (exec falso)", () => {
  it("devuelve stdout, stderr y exit code", async () => {
    const exec = vi.fn(async (_file: string, _args: string[]) => ({ code: 2, stdout: "out", stderr: "err", killed: false }));
    expect(await runInSandbox(["x"], { workspaceDir: "/tmp/ws" }, exec)).toMatchObject({ exitCode: 2, stdout: "out", stderr: "err", timedOut: false, oomKilled: false });
    expect(exec.mock.calls[0][0]).toBe("docker");
  });

  it("al vencer el tiempo mata el contenedor por nombre", async () => {
    const calls: string[][] = [];
    const exec = vi.fn(async (_f: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "run") await new Promise((r) => setTimeout(r, 80));
      return { code: args[0] === "run" ? 137 : 0, stdout: "", stderr: "", killed: false };
    });
    const result = await runInSandbox(["sleep", "999"], { workspaceDir: "/tmp/ws", timeoutMs: 20 }, exec);
    expect(result).toMatchObject({ timedOut: true, oomKilled: false });
    const name = calls[0][calls[0].indexOf("--name") + 1];
    expect(calls.find((a) => a[0] === "kill")).toEqual(["kill", name]);
  });

  it("un exit 137 sin timeout se informa como falta de memoria", async () => {
    const exec = vi.fn(async () => ({ code: 137, stdout: "", stderr: "", killed: false }));
    expect((await runInSandbox(["x"], { workspaceDir: "/tmp/ws" }, exec)).oomKilled).toBe(true);
  });

  it("vitest corre dentro del sandbox y no acepta archivos fuera del workspace", async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: "1 passed", stderr: "", killed: false }));
    const ws = process.cwd();
    expect(await runVitestInSandbox(ws, "package.json", 1000, exec)).toMatchObject({ passed: true });
    const args = (exec.mock.calls[0] as any)[1] as string[];
    expect(args.slice(-5)).toEqual(["vitest", "run", "package.json", "--reporter=verbose", "--color=false"]);
    await expect(runVitestInSandbox(ws, "../../etc/passwd", 1000, exec)).rejects.toThrow(/Acceso denegado/);
  });

  it("la tool resume el resultado para el modelo", async () => {
    const tool = createSandboxTool({ workspaceDir: "/tmp/ws" });
    expect(tool.name).toBe("run_in_sandbox");
    expect(tool.parameters).toMatchObject({ required: ["command"] });
  });
});
