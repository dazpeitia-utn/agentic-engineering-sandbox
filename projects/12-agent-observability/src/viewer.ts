/**
 * Visor de trazas: genera un HTML estático (traces/report.html) con un tablero por
 * servicio y la cascada de spans de cada corrida. No necesita infraestructura.
 *
 *   npm run report -w 12-agent-observability
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTraces, readSpans, serviceStats, type SpanNode, type TraceSummary } from "./traces.js";

const TRACES_DIR = process.env.AGENT_TRACES_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../traces");

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
const usd = (x: number) => `US$${x.toFixed(4)}`;

function kind(node: SpanNode): string {
  if (node.status === "error") return "error";
  const op = node.attributes["gen_ai.operation.name"];
  if (op === "chat") return "llm";
  if (op === "execute_tool") return "tool";
  if (op === "invoke_agent") return "agent";
  if (node.name.startsWith("graph.")) return "node";
  return "other";
}

function flatten(node: SpanNode, out: SpanNode[] = []): SpanNode[] {
  out.push(node);
  node.children.forEach((c) => flatten(c, out));
  return out;
}

function details(node: SpanNode): string {
  const attrs = Object.entries(node.attributes).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  const events = node.events.map((e) => `evento ${e.name} ${JSON.stringify(e.attributes)}`);
  return [...attrs, ...events, node.statusMessage ? `error: ${node.statusMessage}` : ""].filter(Boolean).join("\n");
}

function waterfall(t: TraceSummary): string {
  const rows = flatten(t.root).map((n) => {
    const left = ((n.startMs - t.startMs) / Math.max(t.durationMs, 1)) * 100;
    const width = Math.max(((n.endMs - n.startMs) / Math.max(t.durationMs, 1)) * 100, 0.4);
    const tokens = n.attributes["gen_ai.operation.name"] === "chat" ? ` · ${n.attributes["gen_ai.usage.input_tokens"]}→${n.attributes["gen_ai.usage.output_tokens"]} tok · ${usd(n.costUsd)}` : "";
    return `<div class="row" title="${esc(details(n))}">
      <div class="label" style="padding-left:${n.depth * 14}px"><span class="dot ${kind(n)}"></span>${esc(n.name)}</div>
      <div class="track"><div class="bar ${kind(n)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div></div>
      <div class="meta">${ms(n.endMs - n.startMs)}${tokens}</div>
    </div>`;
  });
  return rows.join("");
}

export function renderReport(traces: TraceSummary[]): string {
  const stats = serviceStats(traces);
  const total = traces.reduce((a, t) => a + t.costUsd, 0);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trazas de agentes</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--llm:#3b6fd8;--tool:#2f9e6e;--node:#8a5cd6;--agent:#9b9a93;--other:#c9c8c1;--error:#d64545}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#9c9b94;--line:#33332f;--agent:#6d6c66;--other:#4a4945}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,sans-serif;padding:24px 16px}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px}.muted{color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}th{font-weight:600;color:var(--muted);font-size:12px}
td.n{text-align:right;font-variant-numeric:tabular-nums}.scroll{overflow-x:auto}
details{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:8px 0}summary{cursor:pointer;padding:10px 12px;display:flex;gap:12px;flex-wrap:wrap}
summary b{font-weight:600}.trace{padding:4px 12px 12px;overflow-x:auto}.row{display:grid;grid-template-columns:minmax(220px,32%) 1fr 210px;gap:8px;align-items:center;padding:2px 0;min-width:720px}
.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.track{position:relative;height:12px;background:var(--bg);border-radius:3px}
.bar{position:absolute;top:0;height:12px;border-radius:3px}.meta{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.llm{background:var(--llm)}.tool{background:var(--tool)}.node{background:var(--node)}.agent{background:var(--agent)}.other{background:var(--other)}.error{background:var(--error)}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0;font-size:12px;color:var(--muted)}.badge{color:var(--error);font-weight:600}
</style></head><body><main>
<h1>Trazas de agentes</h1>
<p class="muted">${traces.length} corridas · ${traces.reduce((a, t) => a + t.spans, 0)} spans · costo estimado ${usd(total)} (precios de referencia del proxy 07). Pasá el mouse por un span para ver sus atributos.</p>
<h2>Por servicio</h2>
<div class="scroll"><table><thead><tr><th>Servicio</th><th>Corridas</th><th>Costo</th><th>p50</th><th>p95</th><th>Llamadas LLM</th><th>Tools</th><th>Errores de tools</th></tr></thead><tbody>
${stats.map((s) => `<tr><td>${esc(s.service)}</td><td class="n">${s.runs}</td><td class="n">${usd(s.costUsd)}</td><td class="n">${ms(s.p50Ms)}</td><td class="n">${ms(s.p95Ms)}</td><td class="n">${s.llmCalls}</td><td class="n">${s.toolCalls}</td><td class="n">${(s.toolErrorRate * 100).toFixed(0)}%</td></tr>`).join("")}
</tbody></table></div>
<h2>Corridas</h2>
<div class="legend"><span><span class="dot agent"></span>agente</span><span><span class="dot node"></span>nodo del grafo</span><span><span class="dot llm"></span>llamada al LLM</span><span><span class="dot tool"></span>tool</span><span><span class="dot error"></span>error</span></div>
${traces.map((t, i) => `<details${i === 0 ? " open" : ""}><summary><b>${esc(t.root.name)}</b><span class="muted">${esc(t.service)}</span><span>${ms(t.durationMs)}</span><span>${usd(t.costUsd)}</span><span class="muted">${t.llmCalls} LLM · ${t.toolCalls} tools · ${t.inputTokens + t.outputTokens} tokens</span>${t.errors ? `<span class="badge">${t.errors} error(es)</span>` : ""}<span class="muted">${new Date(t.startMs).toLocaleString("es-AR")}</span></summary><div class="trace">${waterfall(t)}</div></details>`).join("\n")}
</main></body></html>`;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const traces = buildTraces(await readSpans(TRACES_DIR));
  const out = path.join(TRACES_DIR, "report.html");
  await fs.mkdir(TRACES_DIR, { recursive: true });
  await fs.writeFile(out, renderReport(traces));
  for (const s of serviceStats(traces)) console.log(`${s.service}: ${s.runs} corrida(s) · US$${s.costUsd.toFixed(4)} · p50 ${ms(s.p50Ms)} · p95 ${ms(s.p95Ms)} · ${s.llmCalls} LLM · ${s.toolCalls} tools (${(s.toolErrorRate * 100).toFixed(0)}% con error)`);
  console.log(`\n📊 ${traces.length} corridas → ${out}`);
}
