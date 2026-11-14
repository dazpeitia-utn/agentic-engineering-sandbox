import path from "node:path";
import { fileURLToPath } from "node:url";
import { consoleLogger, createFsTools, createOpenAI, defaultModel, runAgent } from "@sandbox/agent-core";
import { SYSTEM_PROMPT } from "./prompt.js";

/** Carpeta del proyecto: el agente solo puede leer y escribir acá adentro. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runUnitTesterAgent(userGoal: string) {
  console.log(`🤖 Agente iniciado con objetivo: "${userGoal}"\n`);

  const result = await runAgent({
    client: createOpenAI(),
    model: defaultModel(),
    system: SYSTEM_PROMPT,
    user: userGoal,
    tools: createFsTools({ rootDir: PROJECT_ROOT }),
    maxIterations: 8,
    onEvent: consoleLogger(),
  });

  if (result.stoppedReason === "max_iterations") {
    console.warn(`⚠️ El agente no terminó en ${result.iterations} iteraciones.`);
    return null;
  }
  console.log("\n✨ Respuesta final del Agente:\n" + result.finalText);
  return result.finalText;
}
