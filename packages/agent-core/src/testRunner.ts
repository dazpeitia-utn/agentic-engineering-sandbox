import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveInside } from "./fsTools.js";
import { requireString, type AgentTool } from "./tools.js";

const require = createRequire(import.meta.url);

export interface TestRunResult {
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/** Saca los códigos de color ANSI para que el modelo lea texto limpio. */
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Corre Vitest sobre un archivo de tests dentro de `rootDir`, con el mismo
 * Node y sin shell. Nunca lanza por tests fallidos: devuelve el resultado.
 */
export async function runVitest(rootDir: string, testFile: string, timeoutMs = 60_000): Promise<TestRunResult> {
  const fullPath = await resolveInside(rootDir, testFile);
  const vitestCli = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const relative = path.relative(rootDir, fullPath);

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [vitestCli, "run", relative, "--root", rootDir, "--reporter=verbose", "--color=false"],
      { cwd: rootDir, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({
          passed: !error,
          exitCode,
          timedOut: Boolean(error && (error as any).killed),
          output: stripAnsi(`${stdout}\n${stderr}`).trim(),
        });
      },
    );
  });
}

/** Tool `run_tests`: le permite al agente ejecutar un archivo de tests y ver el resultado. */
export function createRunTestsTool({ rootDir, timeoutMs }: { rootDir: string; timeoutMs?: number }): AgentTool {
  return {
    name: "run_tests",
    description: "Ejecuta un archivo de tests con Vitest y devuelve si pasaron y la salida completa (errores y stack traces incluidos).",
    parameters: {
      type: "object",
      properties: { testFile: { type: "string", description: "Ruta relativa del archivo de tests, ej: src/math.test.ts" } },
      required: ["testFile"],
      additionalProperties: false,
    },
    async execute(args) {
      const result = await runVitest(rootDir, requireString(args, "testFile"), timeoutMs);
      const status = result.timedOut ? "TIMEOUT" : result.passed ? "PASARON" : "FALLARON";
      return `Resultado: ${status} (exit code ${result.exitCode})\n\n${result.output}`;
    },
  };
}
