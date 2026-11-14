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

/** Carpeta del proyecto: el agente solo puede leer y escribir acá adentro. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SYSTEM_PROMPT =
  "Eres un Ingeniero de Software Agente Autónomo experto en depuración de código en TypeScript.\n" +
  "Recibes la salida real de un test fallido (con stack trace). Tu proceso:\n" +
  "1. Ubica en el stack trace el archivo y la línea donde falla, y léelo con read_file.\n" +
  "2. Aísla la causa raíz del bug.\n" +
  "3. Aplica el parche mínimo con write_file (archivo completo corregido). No puedes modificar los tests.\n" +
  "4. Ejecuta run_tests para validar. Si siguen fallando, vuelve al paso 1.\n" +
  "5. Termina explicando la causa raíz y el cambio aplicado.";

export interface BugFixResult {
  summary: string | null;
  fixed: boolean;
}

export async function runBugFixerAgent(testFile: string): Promise<BugFixResult> {
  // 1. Capturamos el fallo real: el reporte es la salida de los tests, no un texto inventado.
  const before = await runVitest(PROJECT_ROOT, testFile);
  if (before.passed) {
    console.log(`✅ ${testFile} ya pasa: no hay bug que arreglar.`);
    return { summary: null, fixed: true };
  }
  console.log(`❌ ${testFile} falla. Salida capturada para el agente:\n`);
  console.log(before.output.split("\n").slice(0, 25).join("\n") + "\n");

  // 2. El agente aísla, parchea y valida.
  console.log("🤖 [Bug Fixer Agent] Iniciando análisis del error...");
  const result = await runAgent({
    client: createOpenAI(),
    model: defaultModel(),
    system: SYSTEM_PROMPT,
    user: `El archivo de tests ${testFile} está fallando. Salida de Vitest:\n\n${before.output}`,
    tools: [
      ...createFsTools({
        rootDir: PROJECT_ROOT,
        canWrite: (p) => !/\.(test|spec)\.ts$/.test(p),
        writeDeniedMessage: "No puedes modificar los tests: arregla el código fuente.",
      }),
      createRunTestsTool({ rootDir: PROJECT_ROOT }),
    ],
    maxIterations: 10,
    onEvent: consoleLogger("🐛"),
  });

  // 3. Validación independiente: volvemos a correr los tests nosotros.
  const after = await runVitest(PROJECT_ROOT, testFile);
  return { summary: result.finalText, fixed: after.passed };
}
