import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Bm25Index } from "03-rag-docs-assistant/bm25";
import { cosineSimilarity } from "03-rag-docs-assistant/hybrid";

/**
 * Tipos de memoria de largo plazo:
 *  - semantic: hechos estables ("usa TypeScript", "vive en Rosario");
 *  - episodic: qué pasó en una sesión ("el 14/11 armó el proyecto 07");
 *  - procedural: cómo le gusta que se hagan las cosas ("prefiere respuestas cortas").
 */
export type MemoryType = "semantic" | "episodic" | "procedural";

export interface Memory {
  id: string;
  type: MemoryType;
  /** Tema corto y estable, para detectar duplicados y contradicciones: "lenguaje favorito", "ciudad". */
  subject: string;
  content: string;
  /** 1 (trivial) a 5 (clave). */
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  /** Fecha de vencimiento (memorias temporales: "esta semana estoy de vacaciones"). */
  expiresAt: string | null;
  sourceSession: string;
  embedding: number[];
  /** Versiones anteriores, para poder auditar por qué cambió una memoria. */
  history: Array<{ content: string; updatedAt: string }>;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface ScoredMemory extends Memory {
  score: number;
  relevance: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Store de memorias en un archivo JSON (escritura atómica). */
export class MemoryStore {
  private memories: Memory[] = [];

  private constructor(private file: string, private embed: Embedder, private now: () => Date) {}

  static async open(file: string, embed: Embedder, now: () => Date = () => new Date()): Promise<MemoryStore> {
    const store = new MemoryStore(file, embed, now);
    try {
      store.memories = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    return store;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.memories, null, 2));
    await fs.rename(tmp, this.file);
  }

  all({ includeExpired = false } = {}): Memory[] {
    return this.memories.filter((m) => includeExpired || !this.isExpired(m));
  }

  get(id: string): Memory | undefined {
    return this.memories.find((m) => m.id === id);
  }

  isExpired(m: Memory): boolean {
    return m.expiresAt !== null && new Date(m.expiresAt) <= this.now();
  }

  async add(input: { type: MemoryType; subject: string; content: string; importance: number; ttlDays: number | null; sourceSession: string }): Promise<Memory> {
    const [embedding] = await this.embed([`${input.subject}: ${input.content}`]);
    const now = this.now().toISOString();
    const memory: Memory = {
      id: randomUUID().slice(0, 8),
      type: input.type,
      subject: input.subject,
      content: input.content,
      importance: Math.min(5, Math.max(1, Math.round(input.importance))),
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      expiresAt: input.ttlDays ? new Date(this.now().getTime() + input.ttlDays * DAY).toISOString() : null,
      sourceSession: input.sourceSession,
      embedding,
      history: [],
    };
    this.memories.push(memory);
    return memory;
  }

  async update(id: string, content: string, importance?: number): Promise<Memory> {
    const memory = this.get(id);
    if (!memory) throw new Error(`No existe la memoria ${id}.`);
    memory.history.push({ content: memory.content, updatedAt: memory.updatedAt });
    memory.content = content;
    if (importance) memory.importance = Math.min(5, Math.max(1, Math.round(importance)));
    memory.updatedAt = this.now().toISOString();
    [memory.embedding] = await this.embed([`${memory.subject}: ${content}`]);
    return memory;
  }

  delete(id: string): boolean {
    const before = this.memories.length;
    this.memories = this.memories.filter((m) => m.id !== id);
    return this.memories.length < before;
  }

  /** Olvido: borra las memorias vencidas. */
  purgeExpired(): number {
    const before = this.memories.length;
    this.memories = this.memories.filter((m) => !this.isExpired(m));
    return before - this.memories.length;
  }

  /**
   * Recuperación: relevancia = 0.7 × coseno + 0.3 × BM25 normalizado (las dos piezas del
   * RAG del proyecto 03), combinada con recencia (vida media de 30 días desde el último
   * acceso) e importancia. Devuelve el top-k con un umbral bajo y deja que el LLM decida
   * qué usar: con embeddings reales, las similitudes entre frases cortas en español son
   * bajas ("¿Dónde vivo?" vs "Vive en Rosario" = 0.22), así que un umbral alto o un corte
   * relativo descartaban memorias correctas (lo detectó la suite `memory` del 08).
   * No uso RRF para el puntaje: sirve para ordenar, pero sus valores son relativos.
   */
  async search(query: string, { limit = 5, markAccessed = true, minRelevance = 0.1 } = {}): Promise<ScoredMemory[]> {
    const candidates = this.all();
    if (candidates.length === 0) return [];
    const [queryEmbedding] = await this.embed([query]);
    const bm25 = new Bm25Index(candidates.map((m) => `${m.subject} ${m.content}`)).score(query);
    const maxBm25 = Math.max(...bm25, 1e-9);

    const now = this.now().getTime();
    const scored = candidates.map((m, i) => {
      const relevance = 0.7 * Math.max(0, cosineSimilarity(queryEmbedding, m.embedding)) + 0.3 * (bm25[i] / maxBm25);
      const recency = Math.pow(0.5, (now - new Date(m.lastAccessedAt).getTime()) / (30 * DAY));
      return { ...m, relevance, score: 0.6 * relevance + 0.2 * recency + 0.2 * (m.importance / 5) };
    });
    const results = scored
      .filter((m) => m.relevance >= minRelevance)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (markAccessed) {
      for (const r of results) {
        const m = this.get(r.id)!;
        m.lastAccessedAt = this.now().toISOString();
        m.accessCount++;
      }
    }
    return results;
  }

  /** Memorias parecidas a un texto (para detectar duplicados al escribir). */
  async similar(text: string, limit = 3): Promise<Array<Memory & { similarity: number }>> {
    const [embedding] = await this.embed([text]);
    return this.all()
      .map((m) => ({ ...m, similarity: cosineSimilarity(embedding, m.embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
