import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexedChunk } from "./retriever/hybrid.js";

export const DB_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "vector-db.json");
export const EMBEDDING_MODEL = "text-embedding-3-small";

export interface VectorDatabase {
  embeddingModel: string;
  createdAt: string;
  /** Fuentes indexadas con su hash, para detectar si la documentación cambió. */
  sources: Record<string, string>;
  chunks: IndexedChunk[];
}
