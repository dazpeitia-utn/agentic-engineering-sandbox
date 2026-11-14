import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "@sandbox/agent-core";

const MAX_BYTES = 200_000;

/** Segmentos de ruta que nunca se exponen, aunque estén dentro del monorepo. */
const BLOCKED_SEGMENTS = new Set([".git", "node_modules"]);
const isSecretFile = (name: string) => name === ".env" || (name.startsWith(".env.") && name !== ".env.example");

/**
 * Lee un archivo de texto del monorepo. Rechaza rutas fuera de `rootDir`,
 * secretos (`.env*`), `.git/`, `node_modules/` y archivos demasiado grandes.
 */
export async function readProjectFile(rootDir: string, filePath: string): Promise<string> {
  const fullPath = await resolveInside(rootDir, filePath);
  const segments = path.relative(await fs.realpath(rootDir), fullPath).split(path.sep);

  if (segments.some((s) => BLOCKED_SEGMENTS.has(s))) {
    throw new Error(`Acceso denegado: "${filePath}" está en una carpeta bloqueada.`);
  }
  if (isSecretFile(segments[segments.length - 1])) {
    throw new Error(`Acceso denegado: "${filePath}" puede contener secretos.`);
  }

  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) throw new Error(`"${filePath}" no es un archivo.`);
  if (stat.size > MAX_BYTES) throw new Error(`El archivo supera el límite de ${MAX_BYTES} bytes.`);
  return fs.readFile(fullPath, "utf-8");
}

/** Información del monorepo calculada en el momento (no hardcodeada). */
export async function getMonorepoInfo(rootDir: string) {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf-8"));
  const listDirs = async (dir: string) =>
    (await fs.readdir(path.join(rootDir, dir), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

  const projects = await listDirs("projects");
  return {
    name: pkg.name,
    version: pkg.version,
    activeProjects: projects.length,
    projects,
    packages: await listDirs("packages"),
    stack: ["Node.js", "TypeScript", "MCP", "OpenAI"],
  };
}
