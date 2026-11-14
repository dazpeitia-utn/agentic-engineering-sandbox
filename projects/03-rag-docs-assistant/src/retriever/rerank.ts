import type OpenAI from "openai";
import type { ScoredChunk } from "./hybrid.js";

export interface RerankedChunk extends ScoredChunk {
  /** Relevancia 0-10 asignada por el LLM. */
  relevance: number;
}

/**
 * Re-ranking con el LLM: le pasamos la pregunta y los candidatos, y devuelve un
 * puntaje de relevancia por cada uno (salida estructurada con JSON Schema).
 * Es más caro que la búsqueda, por eso se aplica solo a los mejores N candidatos.
 */
export async function rerankWithLlm(
  openai: OpenAI,
  model: string,
  question: string,
  candidates: ScoredChunk[],
  topK: number,
  minRelevance = 3,
): Promise<RerankedChunk[]> {
  if (candidates.length === 0) return [];

  const list = candidates.map((c, i) => `[${i}] (${c.source} — ${c.section})\n${c.content.slice(0, 1500)}`).join("\n\n---\n\n");
  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Evalúas qué tan útil es cada fragmento de documentación para responder una pregunta. " +
          "Puntúa cada fragmento de 0 (irrelevante) a 10 (responde directamente la pregunta).",
      },
      { role: "user", content: `Pregunta: ${question}\n\nFragmentos:\n\n${list}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "rerank",
        strict: true,
        schema: {
          type: "object",
          properties: {
            scores: {
              type: "array",
              items: {
                type: "object",
                properties: { index: { type: "integer" }, relevance: { type: "integer" } },
                required: ["index", "relevance"],
                additionalProperties: false,
              },
            },
          },
          required: ["scores"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = JSON.parse(response.choices[0]?.message.content ?? '{"scores":[]}') as {
    scores: Array<{ index: number; relevance: number }>;
  };
  const relevance = new Map(parsed.scores.map((s) => [s.index, s.relevance]));

  return candidates
    .map((c, i) => ({ ...c, relevance: relevance.get(i) ?? 0 }))
    .filter((c) => c.relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance || b.score - a.score)
    .slice(0, topK);
}
