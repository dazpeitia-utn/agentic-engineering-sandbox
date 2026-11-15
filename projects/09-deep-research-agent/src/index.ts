import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchRelevantDocs } from "03-rag-docs-assistant/search";
import { runDeepResearch, type DeepResearchEvent } from "./agent.js";
import { runDeepResearchWithDeepagents } from "./deepagents.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_QUESTION =
  "¿Qué es el Model Context Protocol (MCP), quién lo creó y cómo se usa en los proyectos de este monorepo? Compararlo con el protocolo Agent-to-Agent (A2A).";

/** Búsqueda en los READMEs con el RAG híbrido del 03 (sin re-ranking, para ahorrar llamadas). */
const docsSearch = async (query: string) =>
  (await searchRelevantDocs(query, { topK: 3, rerank: false })).map((d) => ({ source: d.source, section: d.section, content: d.content }));

function log(e: DeepResearchEvent) {
  if (e.type === "todos") console.log(`📋 Plan: ${e.todos.map((t) => `${{ pending: "⬜", in_progress: "🔄", completed: "✅" }[t.status]} ${t.content}`).join(" | ")}`);
  if (e.type === "subagent" && e.event.type === "start") console.log(`🧑‍🔬 Subagente → ${e.description.slice(0, 110)}${e.description.length > 110 ? "…" : ""}`);
  if (e.type === "subagent" && e.event.type === "tool_call" && e.event.name.startsWith("wikipedia_page")) console.log(`   📖 ${JSON.stringify(e.event.args)}`);
  if (e.type === "main" && e.event.type === "compacted") console.log(`🗜️ Contexto compactado: ${e.event.charsBefore} → ${e.event.charsAfter} caracteres (${e.event.removedMessages} mensajes resumidos)`);
}

async function main() {
  const args = process.argv.slice(2);
  const engine = args.includes("--engine") ? args[args.indexOf("--engine") + 1] : "own";
  const compactAtChars = args.includes("--compact-at") ? Number(args[args.indexOf("--compact-at") + 1]) : undefined;
  const question = args.find((a, i) => !a.startsWith("--") && !["--engine", "--compact-at"].includes(args[i - 1])) ?? DEFAULT_QUESTION;
  const workspaceDir = path.join(PROJECT_ROOT, "runs", `${engine}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  console.log(`🔭 Deep Research (${engine === "deepagents" ? "LangChain deepagents" : "harness propio"})\n❓ ${question}\n`);

  const started = Date.now();
  const result = engine === "deepagents"
    ? await runDeepResearchWithDeepagents(question, { workspaceDir, docsSearch })
    : await runDeepResearch(question, { workspaceDir, docsSearch, compactAtChars, onEvent: log });

  const c = result.citations;
  console.log(`\n⏱️ ${((Date.now() - started) / 1000).toFixed(0)}s · ${result.sources.length} fuentes consultadas`);
  if ("subagentCalls" in result) console.log(`   ${result.iterations} pasos del agente principal · ${result.subagentCalls} subagentes · ${result.compactions} compactaciones`);
  if (!result.report || !c) {
    console.log("❌ El agente no escribió report.md");
    process.exitCode = 1;
    return;
  }
  console.log(`📑 Citas: ${c.cited.length} fuentes citadas · ${c.invalid.length} inventadas${c.invalid.length ? ` (${c.invalid.join(", ")})` : ""} · ${c.uncitedParagraphs} párrafos sin cita`);
  console.log(`📄 Informe: ${path.relative(process.cwd(), result.reportFile)}`);
  process.exitCode = c.invalid.length === 0 && c.cited.length >= 2 ? 0 : 1;
}

main().catch((error) => {
  console.error("❌", error?.message ?? error);
  process.exit(1);
});
