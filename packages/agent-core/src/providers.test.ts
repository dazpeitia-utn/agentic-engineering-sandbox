import { describe, expect, it, vi } from "vitest";
import { runAgent } from "./agentLoop.js";
import { anthropicClient, fromAnthropicResponse, ProviderUnavailableError, toAnthropicRequest } from "./providers.js";
import { costAwareSelect, isRetryableProviderError, routedClient, type RouteTarget } from "./router.js";
import { generateStructured } from "./structured.js";
import type { AgentTool } from "./tools.js";

describe("adaptador de Anthropic", () => {
  it("traduce system, tool calls y tool results (fusionando mensajes seguidos del mismo rol)", () => {
    const { request } = toAnthropicRequest({
      model: "claude-x",
      temperature: 0,
      messages: [
        { role: "system", content: "sos útil" },
        { role: "user", content: "leé a.ts y b.ts" },
        { role: "assistant", content: null, tool_calls: [
          { id: "t1", type: "function", function: { name: "read_file", arguments: '{"filePath":"a.ts"}' } },
          { id: "t2", type: "function", function: { name: "read_file", arguments: '{"filePath":"b.ts"}' } },
        ] },
        { role: "tool", tool_call_id: "t1", content: "A" },
        { role: "tool", tool_call_id: "t2", content: "B" },
      ],
      tools: [{ type: "function", function: { name: "read_file", description: "lee", parameters: { type: "object", properties: { filePath: { type: "string" } } } } }],
    } as any);
    expect(request).toMatchObject({ model: "claude-x", max_tokens: 4096, system: "sos útil", temperature: 0 });
    expect(request.tools).toEqual([{ name: "read_file", description: "lee", input_schema: { type: "object", properties: { filePath: { type: "string" } } } }]);
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "leé a.ts y b.ts" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { filePath: "a.ts" } }, { type: "tool_use", id: "t2", name: "read_file", input: { filePath: "b.ts" } }] },
      // Los dos resultados van en UN mensaje de user (Anthropic exige alternar roles).
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "A" }, { type: "tool_result", tool_use_id: "t2", content: "B" }] },
    ]);
  });

  it("traduce la respuesta: texto, tool_use → tool_calls, uso y finish_reason", () => {
    const completion: any = fromAnthropicResponse({ id: "m1", model: "claude-x", stop_reason: "tool_use", content: [{ type: "text", text: "voy a leer" }, { type: "tool_use", id: "t9", name: "read_file", input: { filePath: "c.ts" } }], usage: { input_tokens: 50, output_tokens: 7 } }, null);
    expect(completion.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { content: "voy a leer", tool_calls: [{ id: "t9", type: "function", function: { name: "read_file", arguments: '{"filePath":"c.ts"}' } }] } });
    expect(completion.usage).toEqual({ prompt_tokens: 50, completion_tokens: 7, total_tokens: 57 });
  });

  it("la salida estructurada se emula con una tool forzada", async () => {
    const fetchFn = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.tool_choice).toEqual({ type: "tool", name: "respond_plan" });
      return Response.json({ id: "m", model: "claude-x", stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "respond_plan", input: { pasos: ["a", "b"] } }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    const client = anthropicClient({ apiKey: "k", fetchFn: fetchFn as any });
    const plan = await generateStructured<{ pasos: string[] }>({ client, model: "claude-x", system: "s", user: "u", name: "plan", schema: { type: "object" } });
    expect(plan).toEqual({ pasos: ["a", "b"] });
    expect((fetchFn.mock.calls[0][1] as any).headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01" });
  });

  it("un agente completo (runAgent con tools) funciona sobre el adaptador", async () => {
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "sumar", input: { a: 2, b: 3 } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "da 5" }] },
    ];
    const seen: any[] = [];
    const fetchFn = vi.fn(async (_u: any, init: any) => (seen.push(JSON.parse(init.body)), Response.json({ id: "m", model: "c", usage: { input_tokens: 1, output_tokens: 1 }, ...replies.shift() })));
    const sumar: AgentTool = { name: "sumar", description: "suma", parameters: { type: "object" }, execute: async (a: any) => String(a.a + a.b) };
    const result = await runAgent({ client: anthropicClient({ apiKey: "k", fetchFn: fetchFn as any }), model: "claude-x", system: "s", user: "cuánto es 2+3", tools: [sumar] });
    expect(result.finalText).toBe("da 5");
    expect(seen[1].messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "5" }] });
  });

  it("sin API key avisa que el proveedor no está disponible, y un 4xx de la API se informa con su status", async () => {
    await expect(anthropicClient().chat.completions.create({ model: "c", messages: [] })).rejects.toBeInstanceOf(ProviderUnavailableError);
    const fetchFn = vi.fn(async () => Response.json({ error: { message: "bad" } }, { status: 400 }));
    await expect(anthropicClient({ apiKey: "k", fetchFn: fetchFn as any }).chat.completions.create({ model: "c", messages: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe("router", () => {
  const ok = (name: string, model = name): RouteTarget => ({ name, model, client: { chat: { completions: { create: vi.fn(async (p: any) => ({ model: p.model, choices: [{ message: { content: `${name}:${p.model}` } }] }) as any) } } } });
  const failing = (name: string, error: any): RouteTarget => ({ name, model: name, client: { chat: { completions: { create: vi.fn(async () => { throw error; }) } } } });

  it("hace fallback ante un proveedor no disponible y registra la ruta", async () => {
    const events: any[] = [];
    const client = routedClient({ select: () => [failing("anthropic", new ProviderUnavailableError("anthropic", "sin key")), ok("openai", "gpt-4o")], onRoute: (e) => events.push(e) });
    const r: any = await client.chat.completions.create({ model: "lo-que-sea", messages: [] });
    expect(r.choices[0].message.content).toBe("openai:gpt-4o");
    expect(events.map((e) => [e.target, Boolean(e.error)])).toEqual([["anthropic", true], ["openai", false]]);
  });

  it("circuit breaker: un proveedor no disponible no se vuelve a probar", async () => {
    const down = failing("anthropic", new ProviderUnavailableError("anthropic", "sin key"));
    const client = routedClient({ select: () => [down, ok("openai")] });
    for (let i = 0; i < 3; i++) await client.chat.completions.create({ model: "m", messages: [] });
    expect(down.client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("no hace fallback ante un error del pedido (400): fallaría igual en otro proveedor", async () => {
    const second = ok("b");
    const client = routedClient({ select: () => [failing("a", Object.assign(new Error("bad request"), { status: 400 })), second] });
    await expect(client.chat.completions.create({ model: "m", messages: [] })).rejects.toThrow("bad request");
    expect(second.client.chat.completions.create).not.toHaveBeenCalled();
  });

  it("clasifica errores reintentables", () => {
    expect([429, 500, 503, 401].map((status) => isRetryableProviderError({ status }))).toEqual([true, true, true, true]);
    expect(isRetryableProviderError({ status: 400 })).toBe(false);
    expect(isRetryableProviderError(new Error("fetch failed"))).toBe(true);
  });

  it("costAwareSelect: pedidos simples al modelo barato, con tools o contexto largo al fuerte", async () => {
    const select = costAwareSelect([ok("mini")], [ok("fuerte")]);
    expect(select({ model: "x", messages: [{ role: "user", content: "hola" }] } as any).map((t) => t.name)).toEqual(["mini", "fuerte"]);
    expect(select({ model: "x", messages: [], tools: [{ type: "function", function: { name: "t" } }] } as any).map((t) => t.name)).toEqual(["fuerte", "mini"]);
    expect(select({ model: "x", messages: [{ role: "user", content: "x".repeat(10_000) }] } as any)[0].name).toBe("fuerte");
  });
});
