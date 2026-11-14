import { askRagAgent } from "./agent/ragAgent.js";

async function main() {
  const query = process.argv[2] || "¿Cómo funciona el servidor MCP de Git en el proyecto 2?";
  
  console.log("🚀 Iniciando Proyecto 03: RAG Docs Assistant...\n");
  const answer = await askRagAgent(query);
  
  console.log("✨ **Respuesta del Asistente RAG:**\n");
  console.log(answer);
}

main().catch(console.error);