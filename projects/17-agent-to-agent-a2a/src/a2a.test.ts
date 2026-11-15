import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskState } from "@a2a-js/sdk";
import { createAgentApp, listen, type AgentDefinition } from "./a2a.js";
import { connectAgent, orchestrate, waitForTask, type ConnectedAgent } from "./orchestrator.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** Levanta un agente A2A real (HTTP) en un puerto libre. */
async function serve(def: AgentDefinition, token?: string) {
  const { app } = createAgentApp(def, "http://placeholder", { token });
  const server = await listen(app, 0);
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // La card publica la URL real del servidor.
  const { app: real } = createAgentApp(def, url, { token });
  server.removeAllListeners("request");
  server.on("request", real);
  return url;
}

const echo: AgentDefinition = {
  name: "echo-agent",
  description: "Repite el pedido en mayúsculas",
  skills: [{ id: "echo", name: "Eco", description: "Devuelve el texto en mayúsculas" }],
  handle: async (input, progress) => {
    progress("pensando");
    return input.toUpperCase();
  },
};

describe("servidor A2A + cliente oficial del SDK", () => {
  it("el cliente descubre la Agent Card y completa una tarea", async () => {
    const agent = await connectAgent(await serve(echo));
    expect(agent.card).toMatchObject({ name: "echo-agent", skills: [expect.objectContaining({ id: "echo" })] });
    const task = await agent.run("hola agente");
    expect(task.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(task.output).toBe("HOLA AGENTE");
  });

  it("un error del agente termina la tarea en estado failed con el mensaje", async () => {
    const agent = await connectAgent(await serve({ ...echo, handle: async () => { throw new Error("se rompió"); } }));
    const task = await agent.run("x");
    expect(task.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(task.statusText).toMatch(/se rompió/);
  });

  it("con returnImmediately la tarea se puede consultar mientras trabaja", async () => {
    let release!: () => void;
    const slow = { ...echo, handle: () => new Promise<string>((r) => (release = () => r("listo"))) };
    const agent = await connectAgent(await serve(slow));
    const started = await agent.client.sendMessage({ tenant: "", message: (await import("./a2a.js")).userMessage("tarea larga"), configuration: { acceptedOutputModes: ["text/plain"], taskPushNotificationConfig: undefined, returnImmediately: true }, metadata: undefined });
    const id = (started as any).id ?? (started as any).task?.id;
    expect(id).toBeTruthy();
    const working = await agent.client.getTask({ tenant: "", id });
    expect([TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING]).toContain(working.status?.state);
    release();
    expect((await waitForTask(agent, id, { intervalMs: 20 })).output).toBe("listo");
  });

  it("si el agente exige token, sin token no se puede usar", async () => {
    const url = await serve(echo, "secreto");
    const card = await (await fetch(`${url}/.well-known/agent-card.json`)).json();
    expect(card.name).toBe("echo-agent");
    expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const agent = await connectAgent(url, "secreto");
    expect((await agent.run("ok")).output).toBe("OK");
  });
});

describe("orquestador", () => {
  it("descubre agentes, delega según el plan del LLM, en paralelo, y sintetiza", async () => {
    const calls: string[] = [];
    const mk = (name: string, description: string): AgentDefinition => ({
      name,
      description,
      skills: [{ id: name, name, description }],
      handle: async (input) => (calls.push(`${name}:${input}`), `${name} respondió sobre "${input}"`),
    });
    const urls = [await serve(mk("docs-agent", "documentación")), await serve(mk("research-agent", "investigación"))];
    const replies = [
      { delegations: [{ agent: "docs-agent", message: "¿Qué es MCP en el repo?" }, { agent: "research-agent", message: "Historia de MCP" }], reasoning: "dos fuentes" },
      "Síntesis final",
    ];
    const create = vi.fn(async (p: any) => {
      const r = replies.shift()!;
      return { choices: [{ message: { content: typeof r === "string" ? r : JSON.stringify(r) } }] } as any;
    });
    const result = await orchestrate("Explicame MCP", urls, { client: { chat: { completions: { create } } }, model: "m" });
    expect(result.agents.map((a) => a.card.name).sort()).toEqual(["docs-agent", "research-agent"]);
    expect(calls.sort()).toEqual(["docs-agent:¿Qué es MCP en el repo?", "research-agent:Historia de MCP"]);
    expect(result.answer).toBe("Síntesis final");
    // El planificador vio las Agent Cards (no conocía a los agentes de antemano).
    expect((create.mock.calls[0] as any)[0].messages[1].content).toContain("research-agent");
  });

  it("ignora delegaciones a agentes que no existen", async () => {
    const urls = [await serve(echo)];
    const replies = [{ delegations: [{ agent: "fantasma", message: "x" }, { agent: "echo-agent", message: "hola" }], reasoning: "" }, "fin"];
    const create = vi.fn(async () => ({ choices: [{ message: { content: (() => { const r = replies.shift()!; return typeof r === "string" ? r : JSON.stringify(r); })() } }] }) as any);
    const result = await orchestrate("t", urls, { client: { chat: { completions: { create } } }, model: "m" });
    expect(result.results.map((r) => [r.agent, r.state])).toEqual([["echo-agent", TaskState.TASK_STATE_COMPLETED]]);
    expect(result.skipped).toEqual(["fantasma"]);
  });
});

export type { ConnectedAgent };
