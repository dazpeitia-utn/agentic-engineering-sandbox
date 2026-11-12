import OpenAI from "openai";
import { searchRelevantDocs } from "../retriever/searchDocs.js";

// ¡La palabra 'export' es obligatoria aquí!
export async function askRagAgent(question: string) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`🔎 [RAG] Buscando información relevante en el monorepo para: "${question}"...`);
  const relevantDocs = await searchRelevantDocs(question, 3);

  const contextText = relevantDocs
    .map((doc, idx) => `[Fragmento ${idx + 1} - Fuente: ${doc.title}]\n${doc.content}`)
    .join("\n\n---\n\n");

  console.log(`📄 [RAG] Fragmentos encontrados: ${relevantDocs.length}. Generando respuesta con GPT-4o...\n`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Eres un Asistente Técnico experto en este monorepo de ingeniería agéntica. " +
          "Responde a la pregunta del usuario utilizando exclusivamente la información de los fragmentos de documentación provistos a continuación. " +
          "Si la respuesta no se encuentra en los fragmentos, sé sincero y dilo claramente.",
      },
      {
        role: "user",
        content: `Documentación de referencia:\n\n${contextText}\n\nPregunta del usuario: ${question}`,
      },
    ],
  });

  return response.choices[0].message.content;
}