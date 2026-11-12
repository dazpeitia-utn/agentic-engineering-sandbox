import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGitReviewerAgent } from "./agent/agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  console.log("🚀 Iniciando Proyecto 02: MCP Git Code Reviewer...\n");
  await runGitReviewerAgent();
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});