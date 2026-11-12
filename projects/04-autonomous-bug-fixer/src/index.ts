import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBugFixerAgent } from "./agent/bugFixerAgent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const bugReport = 
    "Fallo en test unitario: la función `calculateTotal(100, 20)` esperaba recibir `120`, " +
    "pero el resultado devuelto fue `80`. El archivo a revisar es `src/buggyCode.ts`.";

  console.log("🚀 Iniciando Proyecto 04: Autonomous Bug Fixer...\n");
  const result = await runBugFixerAgent(bugReport);

  console.log("\n✨ **Resultado del Agente Corrector:**\n");
  console.log(result);
}

main().catch(console.error);