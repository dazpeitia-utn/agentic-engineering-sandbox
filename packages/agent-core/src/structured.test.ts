import { describe, expect, it, vi } from "vitest";
import type { ChatClient } from "./agentLoop.js";
import { generateStructured } from "./structured.js";

const clientReturning = (message: Record<string, unknown>) => {
  const create = vi.fn(async () => ({ choices: [{ message: { role: "assistant", content: null, ...message } }] }) as any);
  return { client: { chat: { completions: { create } } } as ChatClient, create };
};

const base = { model: "m", system: "s", user: "u", name: "plan", schema: { type: "object" } };

describe("generateStructured", () => {
  it("manda el schema estricto y parsea la respuesta", async () => {
    const { client, create } = clientReturning({ content: '{"steps":["a","b"]}' });
    expect(await generateStructured<{ steps: string[] }>({ ...base, client })).toEqual({ steps: ["a", "b"] });
    expect((create.mock.calls[0] as any)[0].response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "plan", schema: { type: "object" }, strict: true },
    });
  });

  it("informa si el modelo se niega o responde vacío", async () => {
    await expect(generateStructured({ ...base, client: clientReturning({ refusal: "no" }).client })).rejects.toThrow(/se negó/);
    await expect(generateStructured({ ...base, client: clientReturning({}).client })).rejects.toThrow(/vacía/);
  });
});
