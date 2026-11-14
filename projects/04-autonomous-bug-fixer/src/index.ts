import { runBugFixerAgent } from "./agent/bugFixerAgent.js";

async function main() {
  // Uso: npm start -w 04-autonomous-bug-fixer -- [archivoDeTests]
  const testFile = process.argv[2] ?? "src/buggyCode.test.ts";

  console.log("🚀 Iniciando Proyecto 04: Autonomous Bug Fixer...\n");
  const { summary, fixed } = await runBugFixerAgent(testFile);

  if (summary) console.log("\n✨ **Resultado del Agente Corrector:**\n\n" + summary);
  console.log(`\n${fixed ? "✅ Validado: los tests pasan." : "❌ Los tests siguen fallando."}`);
  process.exitCode = fixed ? 0 : 1;
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});
