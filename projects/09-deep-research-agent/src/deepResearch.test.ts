import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runDeepResearch } from "./agent.js";
import { checkCitations, withSourcesSection } from "./citations.js";
import { SourceRegistry } from "./sources.js";
import { taskTool, todoTool } from "./tools/planning.js";
import { wikipediaTools, type Fetcher } from "./tools/research.js";

/** Wikipedia falsa: un artículo sobre MCP. */
const fakeWikipedia: Fetcher = async (url) => {
  if (url.includes("list=search")) return { query: { search: [{ title: "Model Context Protocol", snippet: "protocolo <b>abierto</b>" }] } };
  if (url.includes("Model%20Context%20Protocol")) return { query: { pages: { "1": { title: "Model Context Protocol", extract: "MCP es un protocolo abierto presentado por Anthropic en 2024." } } } };
  return { query: { pages: { "-1": { title: "x", missing: "" } } } };
};

describe("fuentes y citas", () => {
  it("el registro numera las fuentes y no duplica por url", () => {
    const r = new SourceRegistry();
    expect(r.add({ title: "a", url: "u1", kind: "wikipedia", excerpt: "" }).id).toBe("S1");
    expect(r.add({ title: "b", url: "u2", kind: "wikipedia", excerpt: "" }).id).toBe("S2");
    expect(r.add({ title: "a otra vez", url: "u1", kind: "wikipedia", excerpt: "" }).id).toBe("S1");
  });

  it("detecta citas inventadas, fuentes sin usar y párrafos sin cita", () => {
    const r = new SourceRegistry();
    r.add({ title: "a", url: "u1", kind: "wikipedia", excerpt: "" });
    r.add({ title: "b", url: "u2", kind: "wikipedia", excerpt: "" });
    const long = "Este párrafo tiene contenido factual suficiente como para necesitar una cita, pero el agente no la puso en ningún lado.";
    const report = `# Informe\n\nDato uno [S1]. Dato dos [S1, S9].\n\n${long}\n\n## Fuentes\n- [S1] inventada en la lista`;
    expect(checkCitations(report, r.all())).toEqual({ cited: ["S1", "S9"], invalid: ["S9"], unused: ["S2"], uncitedParagraphs: 1 });
  });

  it("reescribe la sección de fuentes con las fuentes reales", () => {
    const r = new SourceRegistry();
    r.add({ title: "Artículo", url: "https://es.wikipedia.org/wiki/X", kind: "wikipedia", excerpt: "" });
    const out = withSourcesSection("# I\n\nDato [S1].\n\n## Fuentes\n- [S1] https://url-inventada.example", r.all(), ["S1"]);
    expect(out).toContain("https://es.wikipedia.org/wiki/X");
    expect(out).not.toContain("url-inventada");
  });
});

describe("tools", () => {
  it("wikipedia_page registra la fuente y devuelve su id", async () => {
    const r = new SourceRegistry();
    const [, page] = wikipediaTools(r, fakeWikipedia);
    expect(await page.execute({ title: "Model Context Protocol" })).toMatch(/^\[Fuente S1: Model Context Protocol \(Wikipedia es\)/);
    expect(await page.execute({ title: "No existe" })).toMatch(/No existe el artículo/);
    expect(r.all()).toHaveLength(1);
  });

  it("write_todos guarda la lista y avisa cada cambio", async () => {
    const onChange = vi.fn();
    const t = todoTool(onChange);
    await t.execute({ todos: [{ content: "a", status: "completed" }, { content: "b", status: "raro" }] });
    expect(t.todos()).toEqual([{ content: "a", status: "completed" }, { content: "b", status: "pending" }]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("task corre el subagente con contexto limpio: solo ve la descripción", async () => {
    const sent: any[] = [];
    const create = vi.fn(async (p: any) => (sent.push(structuredClone(p)), { choices: [{ message: { role: "assistant", content: "hallazgo [S1]" } }] }) as any);
    const task = taskTool({ client: { chat: { completions: { create } } }, model: "mini", subagents: [{ name: "researcher", description: "d", system: "SUB", tools: [] }] });
    expect(await task.execute({ description: "investigá X", subagent: "researcher" })).toBe("hallazgo [S1]");
    expect(sent[0].model).toBe("mini");
    expect(sent[0].messages).toEqual([{ role: "system", content: "SUB" }, { role: "user", content: "investigá X" }]);
  });
});

/**
 * Corrida completa con un LLM falso con guion: el principal planifica, delega,
 * lee las notas y escribe el informe; el subagente lee Wikipedia y escribe notas.
 */
it("runDeepResearch: planifica, delega a un subagente, sintetiza y valida las citas", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deep-"));
  const call = (name: string, args: object, id = name) => ({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const main = [
    call("write_todos", { todos: [{ content: "Qué es MCP", status: "in_progress" }] }),
    call("task", { subagent: "researcher", description: "Investigá qué es MCP y guardá notas en notes/mcp.md" }),
    call("read_file", { filePath: "notes/mcp.md" }),
    call("write_file", { filePath: "report.md", content: "# MCP\n\nMCP es un protocolo abierto de Anthropic [S1]. Otro dato [S7].\n\n## Fuentes\n- inventada" }),
    { role: "assistant", content: "report.md listo" },
  ];
  const sub = [
    call("wikipedia_page", { title: "Model Context Protocol" }),
    call("write_file", { filePath: "notes/mcp.md", content: "- MCP es de Anthropic [S1]" }),
    { role: "assistant", content: "MCP: protocolo abierto de Anthropic [S1]" },
  ];
  const create = vi.fn(async (params: any) => ({ choices: [{ message: (params.messages[0].content.startsWith("Eres un subagente investigador") ? sub : main).shift() }] }) as any);
  const events: string[] = [];

  const result = await runDeepResearch("¿Qué es MCP?", {
    workspaceDir: dir,
    client: { chat: { completions: { create } } },
    model: "main",
    subagentModel: "mini",
    fetcher: fakeWikipedia,
    onEvent: (e) => events.push(e.type === "subagent" ? `sub:${e.event.type}` : e.type === "main" ? `main:${e.event.type}` : e.type),
  });

  expect(result.subagentCalls).toBe(1);
  expect(result.todos).toEqual([{ content: "Qué es MCP", status: "in_progress" }]);
  expect(result.sources.map((s) => s.id)).toEqual(["S1"]);
  // La cita inventada [S7] se detecta y la sección de fuentes se reemplaza por la real.
  expect(result.citations).toMatchObject({ cited: ["S1", "S7"], invalid: ["S7"] });
  expect(result.report).toContain("https://es.wikipedia.org/wiki/Model_Context_Protocol");
  expect(result.report).not.toContain("inventada");
  expect(events).toContain("todos");
  expect(events).toContain("sub:start");
  // El subagente usó el modelo barato.
  expect(create.mock.calls.some((c: any) => c[0].model === "mini")).toBe(true);
  await fs.rm(dir, { recursive: true, force: true });
});

describe("politeFetcher", () => {
  it("serializa los requests y reintenta un 429 respetando Retry-After", async () => {
    const { politeFetcher } = await import("./tools/research.js");
    const waits: number[] = [];
    const responses = [new Response("", { status: 429, headers: { "retry-after": "2" } }), Response.json({ ok: 1 }), Response.json({ ok: 2 })];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);
    const fetcher = politeFetcher({ minIntervalMs: 0, sleep: async (ms) => void waits.push(ms) });
    expect(await Promise.all([fetcher("https://es.wikipedia.org/a"), fetcher("https://es.wikipedia.org/b")])).toEqual([{ ok: 1 }, { ok: 2 }]);
    expect(waits).toContain(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockRestore();
  });
});
