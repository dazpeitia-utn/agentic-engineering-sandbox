import { describe, expect, it } from "vitest";
import { agentHeaders } from "./llm.js";

describe("agentHeaders", () => {
  it("no manda nada a la API oficial", () => {
    expect(agentHeaders({ npm_package_name: "04-autonomous-bug-fixer" })).toEqual({});
  });

  it("con un proxy, identifica al agente por el paquete de npm y a la corrida por proceso", () => {
    const headers = agentHeaders({ OPENAI_BASE_URL: "http://127.0.0.1:8787/v1", npm_package_name: "04-autonomous-bug-fixer" });
    expect(headers["x-agent-id"]).toBe("04-autonomous-bug-fixer");
    expect(headers["x-run-id"]).toMatch(/^04-autonomous-bug-fixer:\d{4}-/);
  });

  it("AGENT_ID y AGENT_RUN_ID tienen prioridad", () => {
    expect(agentHeaders({ OPENAI_BASE_URL: "x", AGENT_ID: "a", AGENT_RUN_ID: "r", npm_package_name: "p" })).toEqual({ "x-agent-id": "a", "x-run-id": "r" });
  });
});
