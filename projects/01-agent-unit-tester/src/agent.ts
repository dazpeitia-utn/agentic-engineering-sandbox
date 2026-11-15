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
  type ChatClient,
} from "@sandbox/agent-core";
import { SYSTEM_PROMPT } from "./prompt.js";

/** Carpeta del proyecto: por default el agente solo puede leer y escribir acá adentro. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface UnitTesterResult {
  summary: string | null;
  testsPassed: boolean;
}

export interface UnitTesterOptions {
  /** Carpeta de trabajo (default: la del proyecto). La usa el eval harness (08) para aislar cada caso. */
  rootDir?: string;
  client?: ChatClient;
  model?: string;
  verbose?: boolean;
}

/**
 * Genera tests para `sourceFile`, los ejecuta y los itera hasta que pasen.
 * El resultado final se verifica corriendo los tests de nuevo (no confiamos solo en lo que dice el modelo).
 */
export async function runUnitTesterAgent(
  sourceFile: string,
  testFile: string,
  { rootDir = PROJECT_ROOT, client, model, verbose = true }: UnitTesterOptions = {},
): Promise<UnitTesterResult> {
  const log = verbose ? console.log : () => {};
  const goal = `Lee el archivo ${sourceFile} y genera un archivo de tests unitarios completo en ${testFile}. Ejecútalo y déjalo pasando.`;
  log(`🤖 Agente iniciado con objetivo: "${goal}"\n`);

  const result = await runAgent({
    client: client ?? createOpenAI(),
    model: model ?? defaultModel(),
    system: SYSTEM_PROMPT,
    user: goal,
    tools: [
      ...createFsTools({
        rootDir,
        canWrite: (p) => p.endsWith(".test.ts"),
        writeDeniedMessage: "Solo puedes escribir archivos *.test.ts; no modifiques el código fuente.",
      }),
      createRunTestsTool({ rootDir }),
    ],
    maxIterations: 12,
    onEvent: verbose ? consoleLogger() : undefined,
  });

  if (result.stoppedReason === "max_iterations") {
    if (verbose) console.warn(`⚠️ El agente no terminó en ${result.iterations} iteraciones.`);
  } else {
    log("\n✨ Respuesta final del Agente:\n" + result.finalText);
  }

  const verification = await runVitest(rootDir, testFile);
  log(`\n${verification.passed ? "✅" : "❌"} Verificación independiente de ${testFile}: ${verification.passed ? "pasan" : "fallan"}`);
  return { summary: result.finalText, testsPassed: verification.passed };
}
