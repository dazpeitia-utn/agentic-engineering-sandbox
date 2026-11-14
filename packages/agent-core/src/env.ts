import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del monorepo (packages/agent-core/src → ../../..). */
export const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let loaded = false;

/**
 * Carga el `.env` único de la raíz del monorepo. Es idempotente y no pisa
 * variables que ya estén definidas en el entorno (útil en CI).
 */
export function loadEnv(): void {
  if (loaded) return;
  dotenv.config({ path: path.join(MONOREPO_ROOT, ".env"), quiet: true });
  loaded = true;
}

/** Devuelve una variable obligatoria o lanza un error claro. */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable ${name}. Copiá .env.example a .env en la raíz del monorepo y completala.`);
  }
  return value;
}
