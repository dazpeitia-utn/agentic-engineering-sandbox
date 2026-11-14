import { Bm25Index } from "./bm25.js";

export interface IndexedChunk {
  source: string;
  section: string;
  content: string;
  embedding: number[];
}

export interface ScoredChunk extends IndexedChunk {
  /** Puntaje RRF combinado (más alto = más relevante). */
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/** Índices ordenados de mayor a menor puntaje, descartando los que no superan `minScore`. */
function rank(scores: number[], minScore: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((s) => s.score > minScore)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.index);
}

/**
 * Reciprocal Rank Fusion: combina rankings sumando 1 / (k + posición).
 * No necesita normalizar puntajes de escalas distintas (coseno vs BM25).
 */
export function reciprocalRankFusion(rankings: number[][], k = 60): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((docIndex, position) => {
      fused.set(docIndex, (fused.get(docIndex) ?? 0) + 1 / (k + position + 1));
    });
  }
  return fused;
}

/**
 * Búsqueda híbrida: ranking semántico (coseno) + ranking léxico (BM25),
 * fusionados con RRF. Devuelve los `limit` mejores candidatos.
 */
export function hybridSearch(
  chunks: IndexedChunk[],
  query: string,
  queryEmbedding: number[],
  limit: number,
  bm25: Bm25Index = new Bm25Index(chunks.map((c) => c.content)),
): ScoredChunk[] {
  const vectorRanking = rank(chunks.map((c) => cosineSimilarity(queryEmbedding, c.embedding)), -Infinity);
  const keywordRanking = rank(bm25.score(query), 0);
  const fused = reciprocalRankFusion([vectorRanking, keywordRanking]);

  const position = (ranking: number[], i: number) => {
    const p = ranking.indexOf(i);
    return p === -1 ? null : p + 1;
  };

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([index, score]) => ({
      ...chunks[index],
      score,
      vectorRank: position(vectorRanking, index),
      keywordRank: position(keywordRanking, index),
    }));
}
