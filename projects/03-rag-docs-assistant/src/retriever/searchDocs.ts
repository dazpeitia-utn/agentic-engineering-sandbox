import fs from "node:fs/promises";
import path from "node:path";
import { createOpenAI, defaultModel, MONOREPO_ROOT } from "@sandbox/agent-core";
import { findDocs, sha256 } from "../indexer/indexDocs.js";
import { DB_PATH, type VectorDatabase } from "../vectorStore.js";
import { hybridSearch } from "./hybrid.js";
import { rerankWithLlm, type RerankedChunk } from "./rerank.js";

export interface SearchOptions {
  topK?: number;
  /** Candidatos que salen de la búsqueda híbrida y pasan al re-ranking. */
  candidates?: number;
  rerank?: boolean;
}

async function loadDatabase(): Promise<VectorDatabase> {
  let raw: string;
  try {
    raw = await fs.readFile(DB_PATH, "utf-8");
  } catch {
    throw new Error("No existe vector-db.json. Corré primero: npm run index -w 03-rag-docs-assistant");
  }
  const db = JSON.parse(raw);
  if (Array.isArray(db)) {
    throw new Error("vector-db.json tiene el formato viejo. Volvé a indexar: npm run index -w 03-rag-docs-assistant");
  }
  return db as VectorDatabase;
}

/** Avisa si algún README cambió (o se agregó/borró) desde la última indexación. */
async function warnIfStale(db: VectorDatabase): Promise<void> {
  const current = await findDocs();
  const changed = current.filter((doc) => db.sources[doc] === undefined);
  for (const doc of Object.keys(db.sources)) {
    const content = await fs.readFile(path.join(MONOREPO_ROOT, doc), "utf-8").catch(() => null);
    if (content === null || sha256(content) !== db.sources[doc]) changed.push(doc);
  }
  if (changed.length > 0) {
    console.warn(`⚠️ La documentación cambió desde la última indexación (${changed.join(", ")}). Conviene correr npm run index.`);
  }
}

export async function searchRelevantDocs(query: string, { topK = 4, candidates = 12, rerank = true }: SearchOptions = {}): Promise<RerankedChunk[]> {
  const openai = createOpenAI();
  const db = await loadDatabase();
  await warnIfStale(db);

  const { data } = await openai.embeddings.create({ model: db.embeddingModel, input: query });
  const hybrid = hybridSearch(db.chunks, query, data[0].embedding, candidates);

  if (!rerank) return hybrid.slice(0, topK).map((c) => ({ ...c, relevance: Number.NaN }));
  return rerankWithLlm(openai, defaultModel(), query, hybrid, topK);
}
