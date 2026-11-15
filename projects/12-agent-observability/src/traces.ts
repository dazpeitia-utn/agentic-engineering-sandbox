import fs from "node:fs/promises";
import path from "node:path";
import { costOf, DEFAULT_PRICING } from "07-guardrails-eval-proxy/budget";

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  service: string;
  startMs: number;
  endMs: number;
  status: "ok" | "error";
  statusMessage: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timeMs: number; attributes: Record<string, unknown> }>;
}

export interface SpanNode extends SpanRecord {
  children: SpanNode[];
  depth: number;
  /** Costo de este span si es una llamada al LLM (con los precios del proxy 07). */
  costUsd: number;
}

export interface TraceSummary {
  traceId: string;
  service: string;
  root: SpanNode;
  startMs: number;
  durationMs: number;
  spans: number;
  llmCalls: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: number;
}

export async function readSpans(dir: string): Promise<SpanRecord[]> {
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
  const spans: SpanRecord[] = [];
  for (const f of files) {
    for (const line of (await fs.readFile(path.join(dir, f), "utf-8")).split("\n")) {
      if (line.trim()) spans.push(JSON.parse(line));
    }
  }
  return spans;
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export function spanCost(span: SpanRecord): number {
  if (span.attributes["gen_ai.operation.name"] !== "chat") return 0;
  const model = String(span.attributes["gen_ai.request.model"] ?? "");
  return costOf(model, { prompt_tokens: num(span.attributes["gen_ai.usage.input_tokens"]), completion_tokens: num(span.attributes["gen_ai.usage.output_tokens"]) }, DEFAULT_PRICING);
}

/** Arma el árbol de cada traza y calcula sus métricas. */
export function buildTraces(spans: SpanRecord[]): TraceSummary[] {
  const byTrace = new Map<string, SpanRecord[]>();
  for (const s of spans) byTrace.set(s.traceId, [...(byTrace.get(s.traceId) ?? []), s]);

  const traces: TraceSummary[] = [];
  for (const [traceId, list] of byTrace) {
    const nodes = new Map(list.map((s) => [s.spanId, { ...s, children: [] as SpanNode[], depth: 0, costUsd: spanCost(s) }]));
    const roots: SpanNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentSpanId ? nodes.get(n.parentSpanId) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    const setDepth = (n: SpanNode, d: number) => {
      n.depth = d;
      n.children.sort((a, b) => a.startMs - b.startMs);
      n.children.forEach((c) => setDepth(c, d + 1));
    };
    roots.sort((a, b) => a.startMs - b.startMs);
    // Si hay varios spans raíz en la misma traza (raro), se cuelgan de uno virtual.
    const root: SpanNode = roots.length === 1 ? roots[0] : { ...roots[0], spanId: `${traceId}-root`, name: "trace", children: roots, parentSpanId: null, costUsd: 0, endMs: Math.max(...roots.map((r) => r.endMs)) };
    setDepth(root, 0);

    const all = [...nodes.values()];
    const llm = all.filter((s) => s.attributes["gen_ai.operation.name"] === "chat");
    const tools = all.filter((s) => s.attributes["gen_ai.operation.name"] === "execute_tool");
    traces.push({
      traceId,
      service: root.service,
      root,
      startMs: Math.min(...all.map((s) => s.startMs)),
      durationMs: Math.max(...all.map((s) => s.endMs)) - Math.min(...all.map((s) => s.startMs)),
      spans: all.length,
      llmCalls: llm.length,
      toolCalls: tools.length,
      toolErrors: tools.filter((t) => t.status === "error").length,
      inputTokens: llm.reduce((a, s) => a + num(s.attributes["gen_ai.usage.input_tokens"]), 0),
      outputTokens: llm.reduce((a, s) => a + num(s.attributes["gen_ai.usage.output_tokens"]), 0),
      costUsd: all.reduce((a, s) => a + s.costUsd, 0),
      errors: all.filter((s) => s.status === "error").length,
    });
  }
  return traces.sort((a, b) => b.startMs - a.startMs);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Métricas por servicio: costo, latencia p50/p95 y tasa de errores de tools. */
export function serviceStats(traces: TraceSummary[]) {
  const by = new Map<string, TraceSummary[]>();
  for (const t of traces) by.set(t.service, [...(by.get(t.service) ?? []), t]);
  return [...by].map(([service, list]) => {
    const tools = list.reduce((a, t) => a + t.toolCalls, 0);
    const toolErrors = list.reduce((a, t) => a + t.toolErrors, 0);
    return {
      service,
      runs: list.length,
      costUsd: list.reduce((a, t) => a + t.costUsd, 0),
      p50Ms: percentile(list.map((t) => t.durationMs), 50),
      p95Ms: percentile(list.map((t) => t.durationMs), 95),
      llmCalls: list.reduce((a, t) => a + t.llmCalls, 0),
      toolCalls: tools,
      toolErrorRate: tools ? toolErrors / tools : 0,
    };
  }).sort((a, b) => b.costUsd - a.costUsd);
}
