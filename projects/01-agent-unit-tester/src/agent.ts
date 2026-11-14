import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  consoleLogger,
  createFsTools,
  createOpenAI,
  createRunTestsTool,
  defaultModel,
  runAgent,
  runVitest,
} from "@sandbox/agent-core";
import { SYSTEM_PROMPT } from "./prompt.js";

/** Carpeta del proyecto: el agente solo puede leer y escribir acá adentro. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface UnitTesterResult {
  summary: string | null;
  testsPassed: boolean;
}

/**
 * Genera tests para `sourceFile`, los ejecuta y los itera hasta que pasen.
 * El resultado final se verifica corriendo los tests de nuevo (no confiamos solo en lo que dice el modelo).
 */
export async function runUnitTesterAgent(sourceFile: string, testFile: string): Promise<UnitTesterResult> {
  const goal = `Lee el archivo ${sourceFile} y genera un archivo de tests unitarios completo en ${testFile}. Ejecútalo y déjalo pasando.`;
  console.log(`🤖 Agente iniciado con objetivo: "${goal}"\n`);

  const result = await runAgent({
    client: createOpenAI(),
    model: defaultModel(),
    system: SYSTEM_PROMPT,
    user: goal,
    tools: [
      ...createFsTools({
        rootDir: PROJECT_ROOT,
        canWrite: (p) => p.endsWith(".test.ts"),
        writeDeniedMessage: "Solo puedes escribir archivos *.test.ts; no modifiques el código fuente.",
      }),
      createRunTestsTool({ rootDir: PROJECT_ROOT }),
    ],
    maxIterations: 12,
    onEvent: consoleLogger(),
  });

  if (result.stoppedReason === "max_iterations") {
    console.warn(`⚠️ El agente no terminó en ${result.iterations} iteraciones.`);
  } else {
    console.log("\n✨ Respuesta final del Agente:\n" + result.finalText);
  }

  const verification = await runVitest(PROJECT_ROOT, testFile);
  console.log(`\n${verification.passed ? "✅" : "❌"} Verificación independiente de ${testFile}: ${verification.passed ? "pasan" : "fallan"}`);
  return { summary: result.finalText, testsPassed: verification.passed };
}
