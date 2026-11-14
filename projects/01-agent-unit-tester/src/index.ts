import { runUnitTesterAgent } from "./agent.js";

async function main() {
  // Uso: npm start -w 01-agent-unit-tester -- [archivoFuente] [archivoDeTests]
  const sourceFile = process.argv[2] ?? "src/math.ts";
  const testFile = process.argv[3] ?? sourceFile.replace(/\.ts$/, ".test.ts");

  const { testsPassed } = await runUnitTesterAgent(sourceFile, testFile);
  process.exitCode = testsPassed ? 0 : 1;
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error);
  process.exit(1);
});
