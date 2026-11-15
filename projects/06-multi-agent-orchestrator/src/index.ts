import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLLM, FileCheckpointer } from "@sandbox/agent-core";
import { createAgents } from "./agents.js";
import { runCustom } from "./custom/orchestrator.js";
import { runLangGraph } from "./langgraph/orchestrator.js";
import { initialState, type OrchestratorState } from "./state.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TASK =
  "Implementar una función slugify(texto) que convierta un título en un slug para URLs: minúsculas, " +
  "sin acentos ni eñes (ñ → n), espacios y signos reemplazados por guiones, sin guiones repetidos ni al principio o al final. " +
  "Si el resultado queda vacío, lanzar un error.";

function parseArgs(argv: string[]) {
  const engine = argv.includes("--engine") ? argv[argv.indexOf("--engine") + 1] : "custom";
  if (engine !== "custom" && engine !== "langgraph") throw new Error(`--engine debe ser custom o langgraph (recibí "${engine}").`);
  const attemptsArg = argv.includes("--max-attempts") ? Number(argv[argv.indexOf("--max-attempts") + 1]) : 3;
  const skip = new Set([argv.indexOf("--engine") + 1, argv.indexOf("--max-attempts") + 1]);
  const task = argv.find((a, i) => !a.startsWith("--") && !skip.has(i)) ?? DEFAULT_TASK;
  return { engine, task, maxAttempts: Number.isInteger(attemptsArg) && attemptsArg > 0 ? attemptsArg : 3 };
}

async function main() {
  const { engine, task, maxAttempts } = parseArgs(process.argv.slice(2));
  const threadId = `${engine}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const workspaceDir = path.join(PROJECT_ROOT, "workspace", threadId);
  await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });

  console.log(`🚀 Proyecto 06: orquestador multiagente (motor: ${engine})`);
  console.log(`📁 Workspace: ${path.relative(process.cwd(), workspaceDir)}\n📝 Tarea: ${task}\n`);

  const llm = await createLLM();
  console.log(`🔌 Proveedor: ${llm.provider} (${llm.model})`);
  const agents = createAgents({ client: llm.client, model: llm.model, workspaceDir, verbose: false });
  const options = {
    maxAttempts,
    threadId,
    checkpointer: new FileCheckpointer<OrchestratorState>(path.join(PROJECT_ROOT, "workspace", ".checkpoints")),
    onStep: (_node: string, state: OrchestratorState) => console.log(state.log.at(-1)),
  };

  const started = Date.now();
  const { state, steps } = engine === "langgraph"
    ? await runLangGraph(agents, initialState(task), options)
    : await runCustom(agents, initialState(task), options);

  const ok = Boolean(state.testReport?.passed && state.review?.approved);
  console.log(`\n🧭 Camino: ${steps.join(" → ")}`);
  console.log(`⏱️ ${((Date.now() - started) / 1000).toFixed(1)}s, ${state.attempts} intento(s) del desarrollador`);
  if (state.review) {
    console.log(`\n🔎 Revisión: ${state.review.summary}`);
    for (const issue of state.review.issues) console.log(`   - ${issue}`);
  }
  if (state.plan) console.log(`\n📦 Resultado en ${path.relative(process.cwd(), path.join(workspaceDir, state.plan.sourceFile))}`);
  console.log(ok ? "\n✅ Tarea completada: tests pasan y el revisor aprobó." : "\n❌ La tarea no quedó aprobada.");
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error("❌ Error en la ejecución:", error?.message ?? error);
  process.exit(1);
});
