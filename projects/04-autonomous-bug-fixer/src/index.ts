import { runBugFixerAgent } from "./agent/bugFixerAgent.js";

async function main() {
  const bugReport =
    "Fallo en test unitario: la función `calculateTotal(100, 20)` esperaba recibir `120`, " +
    "pero el resultado devuelto fue `80`. El archivo a revisar es `src/buggyCode.ts`.";

  console.log("🚀 Iniciando Proyecto 04: Autonomous Bug Fixer...\n");
  const result = await runBugFixerAgent(bugReport);

  console.log("\n✨ **Resultado del Agente Corrector:**\n");
  console.log(result);
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});
