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

/** Valida un ref (rama, tag, sha, HEAD~2...) para que no pueda ser un flag. */
export function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][\w./@^~{}-]*$/.test(ref) || ref.includes("..")) {
    throw new Error(`Ref inválido: "${ref}".`);
  }
  return ref;
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

/** Diff entre dos commits (lo que se va a pushear). */
export async function gitRangeDiff(base: string, head: string, cwd?: string): Promise<string> {
  const range = `${validateRef(base)}..${validateRef(head)}`;
  return (await runGit(["diff", "--end-of-options", range], cwd)) || "No hay diferencias entre esos commits.";
}

/** Mensajes de los commits entre `base` y `head`. */
export async function gitLog(base: string, head: string, cwd?: string): Promise<string> {
  const range = `${validateRef(base)}..${validateRef(head)}`;
  return (await runGit(["log", "--format=%h %s%n%b", "--end-of-options", range], cwd)) || "No hay commits en ese rango.";
}
