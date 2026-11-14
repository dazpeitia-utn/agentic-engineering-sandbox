import { createOpenAI, defaultModel } from "@sandbox/agent-core";
import { searchRelevantDocs, type SearchOptions } from "../retriever/searchDocs.js";

export async function askRagAgent(question: string, options: SearchOptions = {}) {
  const openai = createOpenAI();

  console.log(`🔎 [RAG] Búsqueda híbrida (embeddings + BM25)${options.rerank === false ? "" : " + re-ranking"} para: "${question}"...`);
  const relevantDocs = await searchRelevantDocs(question, options);

  for (const [i, doc] of relevantDocs.entries()) {
    const relevance = Number.isNaN(doc.relevance) ? "" : ` relevancia ${doc.relevance}/10,`;
    console.log(`   [${i + 1}]${relevance} vector #${doc.vectorRank ?? "-"}, BM25 #${doc.keywordRank ?? "-"} → ${doc.source} — ${doc.section}`);
  }

  if (relevantDocs.length === 0) {
    return "No encontré información relevante en la documentación del monorepo para esa pregunta.";
  }

  const contextText = relevantDocs
    .map((doc, idx) => `[${idx + 1}] Fuente: ${doc.source} — ${doc.section}\n${doc.content}`)
    .join("\n\n---\n\n");

  console.log(`📄 [RAG] ${relevantDocs.length} fragmentos seleccionados. Generando respuesta...\n`);

  const response = await openai.chat.completions.create({
    model: defaultModel(),
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Eres un Asistente Técnico experto en este monorepo de ingeniería agéntica. " +
          "Responde usando exclusivamente la información de los fragmentos provistos y cita las fuentes con su número, ej: [1]. " +
          "Si la respuesta no está en los fragmentos, dilo claramente en vez de inventar.",
      },
      { role: "user", content: `Documentación de referencia:\n\n${contextText}\n\nPregunta del usuario: ${question}` },
    ],
  });

  return response.choices[0].message.content;
}
