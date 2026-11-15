import { describe, expect, it, vi } from "vitest";
import { compactInPlace, runAgent, type ChatClient } from "./agentLoop.js";
import type { AgentTool } from "./tools.js";

/** Cliente falso que devuelve los mensajes indicados, en orden. */
function fakeClient(replies: any[]): ChatClient & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    chat: {
      completions: {
        create: vi.fn(async (params: any) => {
          calls.push(structuredClone(params));
          const message = replies.shift();
          if (!message) throw new Error("no quedan respuestas en el fake");
          return { choices: [{ message: { role: "assistant", content: null, ...message } }] } as any;
        }),
      },
    },
  };
}

const toolCall = (id: string, name: string, args: string) => ({
  tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
});

const echoTool: AgentTool = {
  name: "echo",
  description: "devuelve el texto",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  execute: async (args) => `eco: ${args.text}`,
};

const base = { model: "test-model", system: "sys", user: "hola" };

describe("runAgent", () => {
  it("termina cuando el modelo responde sin tools", async () => {
    const client = fakeClient([{ content: "listo" }]);
    const result = await runAgent({ ...base, client });
    expect(result).toMatchObject({ finalText: "listo", stoppedReason: "completed", iterations: 1 });
    expect(client.calls[0].tools).toBeUndefined();
  });

  it("ejecuta la tool y le devuelve el resultado al modelo", async () => {
    const client = fakeClient([toolCall("c1", "echo", '{"text":"hola"}'), { content: "fin" }]);
    const result = await runAgent({ ...base, client, tools: [echoTool] });
    expect(result.finalText).toBe("fin");
    const toolMsg = client.calls[1].messages.find((m: any) => m.role === "tool");
    expect(toolMsg).toEqual({ role: "tool", tool_call_id: "c1", content: "eco: hola" });
  });

  it("corta en maxIterations si el modelo nunca termina", async () => {
    const replies = Array.from({ length: 5 }, (_, i) => toolCall(`c${i}`, "echo", '{"text":"x"}'));
    const result = await runAgent({ ...base, client: fakeClient(replies), tools: [echoTool], maxIterations: 3 });
    expect(result).toMatchObject({ finalText: null, stoppedReason: "max_iterations", iterations: 3 });
  });

  it("no rompe con JSON inválido, tools inexistentes ni errores de la tool", async () => {
    const failing: AgentTool = { ...echoTool, name: "boom", execute: async () => { throw new Error("explotó"); } };
    const client = fakeClient([
      toolCall("a", "echo", "{no es json"),
      toolCall("b", "no_existe", "{}"),
      toolCall("c", "boom", "{}"),
      { content: "ok" },
    ]);
    const result = await runAgent({ ...base, client, tools: [echoTool, failing] });
    const outputs = result.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(outputs[0]).toMatch(/JSON válido/);
    expect(outputs[1]).toMatch(/no existe/);
    expect(outputs[2]).toMatch(/explotó/);
    expect(result.finalText).toBe("ok");
  });

  it("trunca resultados de tools demasiado largos", async () => {
    const big: AgentTool = { ...echoTool, name: "big", execute: async () => "x".repeat(100) };
    const client = fakeClient([toolCall("c1", "big", "{}"), { content: "fin" }]);
    const result = await runAgent({ ...base, client, tools: [big], maxToolOutputChars: 10 });
    const toolMsg = result.messages.find((m) => m.role === "tool")!;
    expect(toolMsg.content).toMatch(/^x{10}\n\.\.\.\[truncado: 90/);
  });
});

describe("compactación de contexto", () => {
  const big = "x".repeat(200);
  const history = (): any[] => [
    { role: "system", content: "sys" },
    { role: "user", content: "objetivo" },
    { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "t", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: big },
    { role: "assistant", content: null, tool_calls: [{ id: "b", type: "function", function: { name: "t", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "b", content: big },
    { role: "assistant", content: "pensando" },
  ];

  it("resume el medio y conserva system, objetivo y los últimos mensajes", async () => {
    const messages = history();
    const summarize = vi.fn(async (m: any[]) => `resumen de ${m.length}`);
    const events: any[] = [];
    await compactInPlace(messages, { maxChars: 300, keepLast: 2, summarize }, (e) => events.push(e));
    expect(messages[0].content).toBe("sys");
    expect(messages[1].content).toBe("objetivo");
    expect(messages[2].content).toMatch(/Resumen automático de 4 mensajes/);
    // Nunca empieza la parte conservada con un resultado de tool huérfano.
    expect(messages[3].role).not.toBe("tool");
    expect(events[0]).toMatchObject({ type: "compacted", removedMessages: 4 });
  });

  it("no hace nada si el contexto es chico", async () => {
    const messages = history();
    const summarize = vi.fn();
    await compactInPlace(messages, { maxChars: 1_000_000, summarize });
    expect(summarize).not.toHaveBeenCalled();
    expect(messages).toHaveLength(7);
  });

  it("runAgent compacta durante el loop", async () => {
    const replies = [toolCall("c1", "big", "{}"), toolCall("c2", "big", "{}"), toolCall("c3", "big", "{}"), { content: "fin" }];
    const bigTool: AgentTool = { ...echoTool, name: "big", execute: async () => "y".repeat(500) };
    const events: any[] = [];
    const result = await runAgent({
      ...base,
      client: fakeClient(replies),
      tools: [bigTool],
      compaction: { maxChars: 800, keepLast: 2, summarize: async () => "resumen" },
      onEvent: (e) => events.push(e),
    });
    expect(result.finalText).toBe("fin");
    expect(events.some((e) => e.type === "compacted")).toBe(true);
  });
});
