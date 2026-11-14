import path from "node:path";
import { fileURLToPath } from "node:url";
import { consoleLogger, createFsTools, createOpenAI, defaultModel, runAgent } from "@sandbox/agent-core";

/** Carpeta del proyecto: el agente solo puede leer y escribir acá adentro. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SYSTEM_PROMPT =
  "Eres un Ingeniero de Software Agente Autónomo experto en depuración de código en TypeScript. " +
  "Tu objetivo es resolver el error reportado utilizando las herramientas disponibles:\n" +
  "1. Lee el archivo afectado con read_file.\n" +
  "2. Analiza el error lógicamente.\n" +
  "3. Aplica el parche con write_file, escribiendo el archivo completo corregido.\n" +
  "Sé preciso y explica brevemente la causa del bug al terminar.";

export async function runBugFixerAgent(bugReport: string) {
  console.log("🤖 [Bug Fixer Agent] Iniciando análisis del error...");

  const result = await runAgent({
    client: createOpenAI(),
    model: defaultModel(),
    system: SYSTEM_PROMPT,
    user: `Reporte de error / Test fallido:\n${bugReport}`,
    tools: createFsTools({ rootDir: PROJECT_ROOT }),
    maxIterations: 8,
    onEvent: consoleLogger("🐛"),
  });

  if (result.stoppedReason === "max_iterations") {
    return `⚠️ El agente no terminó en ${result.iterations} iteraciones.`;
  }
  return result.finalText || "Proceso de corrección finalizado.";
}
