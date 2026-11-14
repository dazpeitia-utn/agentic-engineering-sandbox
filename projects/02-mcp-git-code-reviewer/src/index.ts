import { runGitReviewerAgent } from "./agent/agent.js";

async function main() {
  // Uso: npm start -w 02-mcp-git-code-reviewer [-- <base> <head>]
  //   sin argumentos: revisa los cambios locales sin commitear
  //   con base y head: revisa los commits entre ambos (ej: origin/main HEAD)
  const [base, head] = process.argv.slice(2);
  console.log("🚀 Iniciando Proyecto 02: MCP Git Code Reviewer...\n");

  const { review, verdict } = await runGitReviewerAgent(base && head ? { range: { base, head } } : {});
  console.log(`\n✨ Code Review Final del Agente MCP:\n\n${review ?? "(el agente no llegó a una conclusión)"}`);
  console.log(`\nVeredicto: ${verdict}`);
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});
