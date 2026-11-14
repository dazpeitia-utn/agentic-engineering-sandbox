import { runGitReviewerAgent } from "./agent/agent.js";

async function main() {
  console.log("🚀 Iniciando Proyecto 02: MCP Git Code Reviewer...\n");
  await runGitReviewerAgent();
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});
