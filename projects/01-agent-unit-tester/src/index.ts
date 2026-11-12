import { runAgent } from './agent.js';

async function main() {
  // Ejemplo: Pedirle que genere un test para un archivo hipotético src/math.ts
  const goal = "Lee el archivo src/math.ts y genérale un archivo de tests unitarios completo en src/math.test.ts";
  await runAgent(goal);
}

main().catch(console.error);
