import { askRagAgent } from "./agent/ragAgent.js";

async function main() {
  // Uso: npm run ask -w 03-rag-docs-assistant -- "pregunta" [--no-rerank]
  const args = process.argv.slice(2);
  const rerank = !args.includes("--no-rerank");
  const query = args.find((a) => !a.startsWith("--")) ?? "¿Cómo funciona el servidor MCP de Git en el proyecto 2?";

  console.log("🚀 Iniciando Proyecto 03: RAG Docs Assistant...\n");
  const answer = await askRagAgent(query, { rerank });

  console.log("✨ **Respuesta del Asistente RAG:**\n");
  console.log(answer);
}

main().catch((error) => {
  console.error("❌", error.message ?? error);
  process.exit(1);
});
