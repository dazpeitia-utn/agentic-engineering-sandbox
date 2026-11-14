import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenAI, MONOREPO_ROOT } from "@sandbox/agent-core";
import { DB_PATH, EMBEDDING_MODEL, type VectorDatabase } from "../vectorStore.js";
import { chunkMarkdown, type Chunk } from "./chunker.js";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Todos los README del monorepo: raíz, packages/* y projects/*. */
export async function findDocs(root: string = MONOREPO_ROOT): Promise<string[]> {
  const docs = ["README.md"];
  for (const dir of ["packages", "projects"]) {
    const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      docs.push(`${dir}/${entry.name}/README.md`);
    }
  }
  const existing: string[] = [];
  for (const doc of docs) {
    try {
      await fs.access(path.join(root, doc));
      existing.push(doc);
    } catch {
      console.warn(`⚠️ Omitiendo '${path.dirname(doc)}': no tiene README.md.`);
    }
  }
  return existing;
}

export async function indexMonorepoDocs() {
  const openai = createOpenAI();
  console.log("📚 [Indexer] Escaneando la documentación del monorepo...");

  const sources: Record<string, string> = {};
  const chunks: Chunk[] = [];
  for (const doc of await findDocs()) {
    const content = await fs.readFile(path.join(MONOREPO_ROOT, doc), "utf-8");
    sources[doc] = sha256(content);
    const docChunks = chunkMarkdown(content, doc);
    chunks.push(...docChunks);
    console.log(`🔍 ${doc}: ${docChunks.length} fragmentos`);
  }

  // Un solo request por lote en vez de uno por fragmento.
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch.map((c) => c.content) });
    embeddings.push(...response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }

  const db: VectorDatabase = {
    embeddingModel: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    sources,
    chunks: chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })),
  };
  await fs.writeFile(DB_PATH, JSON.stringify(db));
  console.log(`✅ [Indexer] ${db.chunks.length} fragmentos de ${Object.keys(sources).length} documentos guardados en vector-db.json.`);
}

// Solo indexamos al correrlo como script (npm run index), no al importarlo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  indexMonorepoDocs().catch((err) => {
    console.error("❌ Error fatal en el indexador:", err);
    process.exit(1);
  });
}
