import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Importa un módulo TypeScript generado por un agente y devuelve una de sus
 * funciones. No hace falta romper el caché de módulos: el harness le da a cada
 * caso su propia carpeta, así que cada módulo tiene una ruta única.
 */
export async function loadFunction(file: string, exportName: string): Promise<(...args: any[]) => any> {
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const candidates = [mod[exportName], mod.default?.[exportName], mod.default];
  const fn = candidates.find((c) => typeof c === "function");
  if (!fn) throw new Error(`El módulo no exporta una función "${exportName}" (exports: ${Object.keys(mod).join(", ") || "ninguno"}).`);
  return fn;
}
