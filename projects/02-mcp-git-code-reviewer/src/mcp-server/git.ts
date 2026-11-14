import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Diffs grandes: subimos el buffer (default de Node = 1 MB). */
const MAX_BUFFER = 20 * 1024 * 1024;

/**
 * Corre git con argumentos separados (sin shell), así nada de lo que mande el
 * modelo se interpreta como comando.
 */
export async function runGit(args: string[], cwd: string = process.cwd()): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout.trim();
}

/** Valida una ruta pedida por el modelo antes de pasársela a git. */
export function validateRepoPath(filePath: string): string {
  if (filePath.includes("\0")) throw new Error("Ruta inválida.");
  if (filePath.startsWith("-")) throw new Error("La ruta no puede empezar con '-'.");
  return filePath;
}

export async function gitStatus(cwd?: string): Promise<string> {
  return (await runGit(["status", "--short"], cwd)) || "El directorio de trabajo está limpio (sin cambios).";
}

export async function gitDiff(options: { staged?: boolean; filePath?: string }, cwd?: string): Promise<string> {
  const args = ["diff"];
  if (options.staged) args.push("--staged");
  // `--` separa opciones de rutas: lo que venga después nunca es un flag.
  if (options.filePath) args.push("--", validateRepoPath(options.filePath));
  return (await runGit(args, cwd)) || "No hay diferencias (diff vacío) para los parámetros indicados.";
}
