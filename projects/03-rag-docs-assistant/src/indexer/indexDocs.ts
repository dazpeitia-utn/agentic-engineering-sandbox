import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DB_PATH = path.resolve(__dirname, "../vector-db.json");

async function generateEmbedding(text: string, openai: OpenAI) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function indexMonorepoDocs() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en el archivo .env de 03-rag-docs-assistant");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log("📚 [Indexer] Escaneando dinámicamente la documentación del monorepo...");

  // Apuntamos directamente a la carpeta 'projects/'
  const projectsDir = path.resolve(__dirname, "../../../");
  const vectorDatabase: Array<{ title: string; content: string; embedding: number[] }> = [];

  try {
    // Leemos de forma dinámica todas las carpetas dentro de 'projects/'
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectName = entry.name;
        const readmePath = path.join(projectsDir, projectName, "README.md");

        try {
          const content = await fs.readFile(readmePath, "utf-8");
          const chunks = content.split("\n\n").filter((chunk) => chunk.trim().length > 20);

          console.log(`🔍 Procesando ${projectName} (${chunks.length} fragmentos encontrados)...`);

          for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk, openai);
            vectorDatabase.push({
              title: projectName,
              content: chunk,
              embedding,
            });
          }
        } catch {
          // Si una carpeta no tiene README.md (como node_modules o algún experimento sin doc), la ignoramos silenciosamente
          console.warn(`⚠️ Omitiendo '${projectName}': No se encontró README.md.`);
        }
      }
    }
  } catch (error: any) {
    console.error(`❌ Error al leer el directorio de proyectos: ${error.message}`);
  }

  // Guardamos la base de datos vectorial local
  await fs.writeFile(DB_PATH, JSON.stringify(vectorDatabase, null, 2));
  console.log(`✅ [Indexer] Indexación completada. Base vectorial guardada en vector-db.json (${vectorDatabase.length} fragmentos totales).`);
}

indexMonorepoDocs().catch((err) => {
  console.error("❌ Error fatal en el indexador:", err);
  process.exit(1);
});