import fs from "node:fs/promises";
import path from "node:path";
import { requireString, type AgentTool } from "./tools.js";

/**
 * Resuelve `relativePath` dentro de `rootDir` y lanza si se sale de ahí
 * (rutas absolutas, `..` o symlinks que apunten afuera).
 */
export async function resolveInside(rootDir: string, relativePath: string): Promise<string> {
  const root = await fs.realpath(rootDir);
  const target = path.resolve(root, relativePath);
  assertInside(root, target, relativePath);

  // Si el archivo (o su carpeta más cercana que exista) es un symlink, validamos el destino real.
  let existing = target;
  while (true) {
    try {
      const real = await fs.realpath(existing);
      assertInside(root, real, relativePath);
      break;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
  }
  return target;
}

function assertInside(root: string, target: string, original: string): void {
  const rel = path.relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error(`Acceso denegado: "${original}" está fuera de la carpeta permitida.`);
}

export interface FsToolsOptions {
  /** Carpeta a la que quedan limitadas todas las lecturas y escrituras. */
  rootDir: string;
  /** Si es false, solo se expone `read_file`. */
  allowWrite?: boolean;
  /** Tamaño máximo de archivo a leer, en bytes (default 200 KB). */
  maxReadBytes?: number;
  /**
   * Filtro opcional de escritura: recibe la ruta relativa a `rootDir` y
   * devuelve true si el agente puede escribirla (ej: solo archivos *.test.ts).
   */
  canWrite?: (relativePath: string) => boolean;
  /** Mensaje que ve el modelo cuando `canWrite` rechaza una ruta. */
  writeDeniedMessage?: string;
}

/** Tools `read_file` y `write_file` limitadas a `rootDir`. */
export function createFsTools({
  rootDir,
  allowWrite = true,
  maxReadBytes = 200_000,
  canWrite = () => true,
  writeDeniedMessage = "No tenés permiso para escribir ese archivo.",
}: FsToolsOptions): AgentTool[] {
  const readFile: AgentTool = {
    name: "read_file",
    description: "Lee un archivo de texto. La ruta es relativa a la carpeta del proyecto.",
    parameters: {
      type: "object",
      properties: { filePath: { type: "string", description: "Ruta relativa, ej: src/math.ts" } },
      required: ["filePath"],
      additionalProperties: false,
    },
    async execute(args) {
      const filePath = requireString(args, "filePath");
      const fullPath = await resolveInside(rootDir, filePath);
      const stat = await fs.stat(fullPath);
      if (stat.size > maxReadBytes) {
        throw new Error(`El archivo pesa ${stat.size} bytes y supera el límite de ${maxReadBytes}.`);
      }
      return fs.readFile(fullPath, "utf-8");
    },
  };

  const writeFile: AgentTool = {
    name: "write_file",
    description: "Crea o reemplaza un archivo con el contenido completo indicado. La ruta es relativa a la carpeta del proyecto.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Ruta relativa, ej: src/math.test.ts" },
        content: { type: "string", description: "Contenido completo del archivo." },
      },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
    async execute(args) {
      const filePath = requireString(args, "filePath");
      if (typeof args.content !== "string") throw new Error('El argumento "content" debe ser un string.');
      const fullPath = await resolveInside(rootDir, filePath);
      const relative = path.relative(await fs.realpath(rootDir), fullPath).split(path.sep).join("/");
      if (!canWrite(relative)) throw new Error(`${writeDeniedMessage} (${filePath})`);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, args.content, "utf-8");
      return `Archivo guardado: ${filePath}`;
    },
  };

  return allowWrite ? [readFile, writeFile] : [readFile];
}
