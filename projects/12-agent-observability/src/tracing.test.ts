import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { END, START, StateGraph, generateStructured, runAgent, type AgentTool } from "@sandbox/agent-core";
import { serializeSpan } from "./serialize.mjs";
import { buildTraces, serviceStats, type SpanRecord } from "./traces.js";
import { renderReport } from "./viewer.js";

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
});
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

const fakeClient = (replies: any[]) => ({
  chat: { completions: { create: async () => ({ model: "gpt-4o-2024", choices: [{ finish_reason: "stop", message: { role: "assistant", content: null, ...replies.shift() } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }) as any } },
});
const toolCall = (name: string) => ({ tool_calls: [{ id: `c-${name}`, type: "function", function: { name, arguments: "{}" } }] });
const ok: AgentTool = { name: "leer", description: "", parameters: { type: "object" }, execute: async () => "contenido" };
const broken: AgentTool = { name: "romper", description: "", parameters: { type: "object" }, execute: async () => { throw new Error("falló"); } };

const records = (): SpanRecord[] => exporter.getFinishedSpans().map((s) => serializeSpan(s) as SpanRecord);

describe("instrumentación de agent-core", () => {
  it("runAgent genera invoke_agent → chat / execute_tool con atributos GenAI", async () => {
    await runAgent({ name: "probador", client: fakeClient([toolCall("leer"), toolCall("romper"), { content: "fin" }]), model: "gpt-4o", system: "s", user: "u", tools: [ok, broken] });
    const spans = records();
    const root = spans.find((s) => s.name === "invoke_agent probador")!;
    expect(root.attributes).toMatchObject({ "gen_ai.operation.name": "invoke_agent", "agent.iterations": 3, "agent.stopped_reason": "completed" });

    const children = spans.filter((s) => s.parentSpanId === root.spanId).map((s) => s.name);
    expect(children).toEqual(["chat gpt-4o", "execute_tool leer", "chat gpt-4o", "execute_tool romper", "chat gpt-4o"]);

    const chat = spans.find((s) => s.name === "chat gpt-4o")!;
    expect(chat.attributes).toMatchObject({ "gen_ai.request.model": "gpt-4o", "gen_ai.usage.input_tokens": 1000, "gen_ai.usage.output_tokens": 100, "gen_ai.response.finish_reasons": ["stop"] });
    expect(spans.find((s) => s.name === "execute_tool romper")).toMatchObject({ status: "error", attributes: { "tool.error": true } });
  });

  it("los nodos del grafo envuelven a los agentes y a las llamadas estructuradas", async () => {
    const graph = new StateGraph<{ out: string }>()
      .addNode("planear", async () => {
        const plan = await generateStructured<{ x: number }>({ client: fakeClient([{ content: '{"x":1}' }]), model: "gpt-4o-mini", system: "s", user: "u", name: "plan", schema: { type: "object" } });
        return { out: String(plan.x) };
      })
      .addNode("ejecutar", async () => ({ out: (await runAgent({ name: "ejecutor", client: fakeClient([{ content: "ok" }]), model: "gpt-4o", system: "s", user: "u" })).finalText! }))
      .addEdge(START, "planear")
      .addEdge("planear", "ejecutar")
      .addEdge("ejecutar", END)
      .compile();
    await graph.invoke({ out: "" });
    const spans = records();
    const parentName = (name: string) => spans.find((p) => p.spanId === spans.find((s) => s.name === name)!.parentSpanId)?.name;
    expect(parentName("chat gpt-4o-mini")).toBe("graph.node planear");
    expect(parentName("invoke_agent ejecutor")).toBe("graph.node ejecutar");
    expect(spans.find((s) => s.name === "chat gpt-4o-mini")?.attributes["structured.schema"]).toBe("plan");
    // Toda la corrida es UNA traza con raíz graph.run.
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    expect(parentName("graph.node planear")).toBe("graph.run");
  });
});

describe("visor", () => {
  it("arma el árbol, calcula costo y métricas por servicio, y genera el HTML", async () => {
    await runAgent({ name: "a", client: fakeClient([toolCall("romper"), { content: "fin" }]), model: "gpt-4o", system: "s", user: "u", tools: [broken] });
    const [t] = buildTraces(records());
    expect(t).toMatchObject({ llmCalls: 2, toolCalls: 1, toolErrors: 1, inputTokens: 2000, outputTokens: 200 });
    // 2 × (1000 × 2.5 + 100 × 10) / 1M
    expect(t.costUsd).toBeCloseTo(0.007);
    expect(t.root.children.map((c) => c.depth)).toEqual([1, 1, 1]);
    expect(serviceStats([t])[0]).toMatchObject({ runs: 1, toolErrorRate: 1 });
    const html = renderReport([t]);
    expect(html).toContain("invoke_agent a");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).not.toContain("<script");
  });
});
