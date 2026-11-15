/**
 * CLI de aprobaciones. Cada comando es un proceso nuevo: la corrida vive en el
 * checkpoint en disco, no en memoria. Por eso se puede cerrar la terminal (o matar
 * el proceso) mientras espera una aprobación y retomar después.
 *
 *   npm run hitl -w 10-human-in-the-loop -- start ["tarea"]
 *   npm run hitl -w 10-human-in-the-loop -- pending
 *   npm run hitl -w 10-human-in-the-loop -- resume <id>      (si el proceso se cortó)
 *   npm run hitl -w 10-human-in-the-loop -- approve <id> [--comment "..."]
 *   npm run hitl -w 10-human-in-the-loop -- reject  <id> [--comment "..."]
 *   npm run hitl -w 10-human-in-the-loop -- edit    <id> --file <archivo-con-el-contenido-final>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI, defaultModel, FileCheckpointer, type StepEvent } from "@sandbox/agent-core";
import { buildHitlGraph, initialHitlState, llmProposer, type ApprovalRequest, type HitlState, type HumanAnswer } from "./agent.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = path.join(PROJECT_ROOT, "runs");
const checkpointer = new FileCheckpointer<HitlState>(path.join(RUNS, "checkpoints"));
const DEFAULT_TASK = "Renombrá la función calcPrecio a calcularPrecioFinal en todo el proyecto (código y README) y agregale un comentario JSDoc que explique sus parámetros.";

const graph = () => buildHitlGraph({ propose: llmProposer(createOpenAI(), defaultModel()), checkpointer });
const flag = (args: string[], name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

function printRequest(id: string, req: ApprovalRequest) {
  console.log(`\n⏸️  [${id}] Esperando aprobación ${req.index}/${req.total}: ${req.file}`);
  console.log(`   Motivo: ${req.reason}\n`);
  console.log(req.diff.split("\n").slice(4).map((l) => (l.startsWith("+") ? `\x1b[32m${l}\x1b[0m` : l.startsWith("-") ? `\x1b[31m${l}\x1b[0m` : l)).join("\n"));
  console.log(`\n   npm run hitl -w 10-human-in-the-loop -- approve ${id}   |   reject ${id}   |   edit ${id} --file <archivo>`);
}

async function report(id: string, events: AsyncGenerator<StepEvent<HitlState>>) {
  for await (const e of events) {
    if (e.interrupt) return printRequest(id, e.interrupt as ApprovalRequest);
    if (e.node === "propose") console.log(`📝 El agente propuso ${e.state.proposals.length} cambio(s): ${e.state.proposals.map((p) => p.file).join(", ")}`);
    if (e.node === "review") {
      const d = e.state.decisions.at(-1)!;
      console.log(`${{ approve: "✅", reject: "🚫", edit: "✏️" }[d.decision]} ${d.file}: ${d.decision}${d.by === "policy" ? " (auto-aprobado por la política: es documentación)" : ""}`);
    }
    if (e.node === "apply") {
      console.log(`\n💾 Aplicados: ${e.state.applied.join(", ") || "ninguno"}`);
      if (e.state.testsPassed !== null) console.log(`${e.state.testsPassed ? "✅ Los tests pasan" : "❌ Los tests fallan"} después de aplicar los cambios.\n${e.state.testOutput}`);
      console.log(`📁 Workspace: ${path.relative(process.cwd(), e.state.workspaceDir)}`);
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "start") {
    const id = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const workspaceDir = path.join(RUNS, id, "workspace");
    await fs.cp(path.join(PROJECT_ROOT, "demo"), workspaceDir, { recursive: true });
    const task = args.find((a) => !a.startsWith("--")) ?? DEFAULT_TASK;
    console.log(`🚀 [${id}] ${task}`);
    await report(id, graph().stream(initialHitlState(task, workspaceDir), { threadId: id }));
    return;
  }

  if (command === "pending") {
    const files = (await fs.readdir(path.join(RUNS, "checkpoints")).catch(() => [])).filter((f) => f.endsWith(".json"));
    let found = 0;
    for (const f of files) {
      const cp = await checkpointer.load(f.replace(/\.json$/, ""));
      if (cp?.status !== "interrupted") continue;
      found++;
      const req = cp.interrupt!.payload as ApprovalRequest;
      console.log(`⏸️  ${cp.threadId}: ${req.file} (${req.index}/${req.total}) — ${req.reason}`);
    }
    if (!found) console.log("No hay aprobaciones pendientes.");
    return;
  }

  if (command === "resume") {
    // Retoma una corrida que se cortó (proceso muerto, error de red) desde su último checkpoint.
    const id = args[0];
    const cp = await checkpointer.load(id);
    if (!cp) throw new Error(`No existe la corrida ${id}.`);
    if (cp.status === "interrupted") throw new Error("Esa corrida está esperando una aprobación: usá approve / reject / edit.");
    console.log(`🔁 [${id}] Retomando desde "${cp.next}" (paso ${cp.step})`);
    await report(id, graph().resumeStream(id));
    return;
  }

  if (["approve", "reject", "edit"].includes(command)) {
    const id = args[0];
    if (!id) throw new Error(`Uso: ${command} <id>`);
    const cp = await checkpointer.load(id);
    if (cp?.status !== "interrupted") throw new Error(`La corrida ${id} no está esperando una aprobación (estado: ${cp?.status ?? "no existe"}).`);
    const file = flag(args, "file");
    if (command === "edit" && !file) throw new Error("edit necesita --file con el contenido final del archivo.");
    const answer: HumanAnswer = { decision: command as HumanAnswer["decision"], comment: flag(args, "comment"), content: file ? await fs.readFile(file, "utf-8") : undefined };
    await report(id, graph().resumeStream(id, { resumeValue: answer }));
    return;
  }

  throw new Error("Comandos: start, pending, resume, approve, reject, edit");
}

main().catch((error) => {
  console.error("❌", error?.message ?? error);
  process.exit(1);
});
