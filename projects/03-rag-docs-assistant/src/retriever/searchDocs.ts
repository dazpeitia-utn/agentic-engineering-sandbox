import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../vector-db.json");

// Función matemática para calcular la similitud de coseno entre dos vectores
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function searchRelevantDocs(query: string, topK: number = 3) {
  // Instanciamos OpenAI aquí adentro para que process.env.OPENAI_API_KEY ya esté disponible
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const dbRaw = await fs.readFile(DB_PATH, "utf-8");
    const vectorDatabase: Array<{ title: string; content: string; embedding: number[] }> = JSON.parse(dbRaw);

    // Generar embedding para la pregunta del usuario
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    const queryEmbedding = queryEmbeddingResponse.data[0].embedding;

    // Calcular similitud con cada fragmento guardado
    const scoredResults = vectorDatabase.map((item) => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    }));

    // Ordenar de mayor a menor similitud y devolver los topK
    scoredResults.sort((a, b) => b.score - a.score);
    return scoredResults.slice(0, topK);
  } catch (error) {
    console.error("❌ Error en la búsqueda vectorial. Asegúrate de correr la indexación primero con 'npm run index'.");
    return [];
  }
}