import { runUnitTesterAgent } from "./agent.js";

async function main() {
  const goal = process.argv[2] ?? "Lee el archivo src/math.ts y genérale un archivo de tests unitarios completo en src/math.test.ts";
  await runUnitTesterAgent(goal);
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});
