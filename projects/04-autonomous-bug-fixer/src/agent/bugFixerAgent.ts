import { existsSync } from "node:fs";
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

/** Carpeta del proyecto: por default el agente solo puede leer y escribir acá adentro. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SYSTEM_PROMPT =
  "Eres un Ingeniero de Software Agente Autónomo experto en depuración de código en TypeScript.\n" +
  "Recibes la salida real de un test fallido (con stack trace). Tu proceso:\n" +
  "1. Ubica en el stack trace el archivo y la línea donde falla. Si solo aparece el test, léelo y busca qué módulo importa: " +
  "el proyecto usa TypeScript ESM, así que `import ... from './x.js'` corresponde al archivo `x.ts`. Lee ese archivo con read_file.\n" +
  "2. Aísla la causa raíz del bug.\n" +
  "3. Aplica el parche mínimo con write_file sobre el archivo .ts existente (archivo completo corregido). " +
  "No puedes modificar los tests ni crear archivos nuevos.\n" +
  "4. Ejecuta run_tests para validar. Si siguen fallando, vuelve al paso 1.\n" +
  "5. Termina explicando la causa raíz y el cambio aplicado.";

export interface BugFixResult {
  summary: string | null;
  fixed: boolean;
}

export interface BugFixerOptions {
  /** Carpeta de trabajo (default: la del proyecto). La usa el eval harness (08) para aislar cada caso. */
  rootDir?: string;
  client?: ChatClient;
  model?: string;
  verbose?: boolean;
}

export async function runBugFixerAgent(
  testFile: string,
  { rootDir = PROJECT_ROOT, client, model, verbose = true }: BugFixerOptions = {},
): Promise<BugFixResult> {
  const log = verbose ? console.log : () => {};

  // 1. Capturamos el fallo real: el reporte es la salida de los tests, no un texto inventado.
  const before = await runVitest(rootDir, testFile);
  if (before.passed) {
    log(`✅ ${testFile} ya pasa: no hay bug que arreglar.`);
    return { summary: null, fixed: true };
  }
  log(`❌ ${testFile} falla. Salida capturada para el agente:\n`);
  log(before.output.split("\n").slice(0, 25).join("\n") + "\n");

  // 2. El agente aísla, parchea y valida.
  log("🤖 [Bug Fixer Agent] Iniciando análisis del error...");
  const result = await runAgent({
    client: client ?? createOpenAI(),
    model: model ?? defaultModel(),
    system: SYSTEM_PROMPT,
    user: `El archivo de tests ${testFile} está fallando. Salida de Vitest:\n\n${before.output}`,
    tools: [
      ...createFsTools({
        rootDir,
        // Solo puede modificar archivos que ya existen y no son tests. Sin esto, el agente a veces "arreglaba"
        // el bug creando un src/x.js nuevo que el test importaba en lugar del src/x.ts con el bug (lo detectó el eval 08).
        canWrite: (p) => !/\.(test|spec)\.ts$/.test(p) && existsSync(path.join(rootDir, p)),
        writeDeniedMessage: "Solo puedes modificar archivos de código que ya existen (no tests ni archivos nuevos): arregla el .ts que importa el test.",
      }),
      createRunTestsTool({ rootDir }),
    ],
    maxIterations: 10,
    onEvent: verbose ? consoleLogger("🐛") : undefined,
  });

  // 3. Validación independiente: volvemos a correr los tests nosotros.
  const after = await runVitest(rootDir, testFile);
  return { summary: result.finalText, fixed: after.passed };
}
