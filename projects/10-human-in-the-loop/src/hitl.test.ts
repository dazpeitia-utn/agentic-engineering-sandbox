import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileCheckpointer, MemoryCheckpointer } from "@sandbox/agent-core";
import { buildHitlGraph, defaultPolicy, initialHitlState, type ApprovalRequest, type Change, type HitlState } from "./agent.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(PROJECT_ROOT, "runs", "test-"));
  await fs.cp(path.join(PROJECT_ROOT, "demo"), workspace, { recursive: true });
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

/** Propuesta fija (sin LLM): renombra calcPrecio en los tres archivos. */
async function renameProposal(): Promise<Change[]> {
  const read = (f: string) => fs.readFile(path.join(workspace, f), "utf-8");
  const rename = (s: string) => s.replaceAll("calcPrecio", "calcularPrecioFinal");
  return [
    { file: "src/precios.ts", newContent: rename(await read("src/precios.ts")), reason: "renombrar" },
    { file: "src/carrito.ts", newContent: rename(await read("src/carrito.ts")), reason: "actualizar import" },
    { file: "README.md", newContent: rename(await read("README.md")), reason: "docs" },
  ];
}

const pending = async (graph: ReturnType<typeof buildHitlGraph>, id: string) => (await graph.getState(id))?.interrupt?.payload as ApprovalRequest | undefined;

describe("human-in-the-loop", () => {
  it("pide aprobación para el código, auto-aprueba la documentación, aplica y corre los tests", async () => {
    const propose = vi.fn(async () => renameProposal());
    const graph = buildHitlGraph({ propose, checkpointer: new MemoryCheckpointer<HitlState>() });
    await graph.invoke(initialHitlState("renombrar", workspace), { threadId: "t" });

    expect(await pending(graph, "t")).toMatchObject({ index: 1, total: 3, file: "src/precios.ts" });
    expect((await pending(graph, "t"))!.diff).toContain("+export function calcularPrecioFinal");
    // Nada se escribió todavía.
    expect(await fs.readFile(path.join(workspace, "src/precios.ts"), "utf-8")).toContain("calcPrecio(");

    await graph.resume("t", { resumeValue: { decision: "approve" } });
    expect(await pending(graph, "t")).toMatchObject({ index: 2, file: "src/carrito.ts" });
    const final = await graph.resume("t", { resumeValue: { decision: "approve" } });

    expect(final.decisions.map((d) => `${d.file}:${d.decision}:${d.by}`)).toEqual(["src/precios.ts:approve:human", "src/carrito.ts:approve:human", "README.md:approve:policy"]);
    expect(final.applied).toEqual(["src/precios.ts", "src/carrito.ts", "README.md"]);
    expect(final.testsPassed).toBe(true);
    // El LLM no se volvió a llamar al retomar: el interrupt está en un nodo aparte.
    expect(propose).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("rechazar uno solo deja el proyecto roto, y los tests lo muestran", async () => {
    const graph = buildHitlGraph({ propose: renameProposal, checkpointer: new MemoryCheckpointer<HitlState>() });
    await graph.invoke(initialHitlState("renombrar", workspace), { threadId: "t" });
    await graph.resume("t", { resumeValue: { decision: "approve" } });
    const final = await graph.resume("t", { resumeValue: { decision: "reject", comment: "no tocar el carrito" } });
    expect(final.applied).toEqual(["src/precios.ts", "README.md"]);
    expect(final.decisions[1]).toMatchObject({ decision: "reject", comment: "no tocar el carrito" });
    expect(final.testsPassed).toBe(false);
  }, 60_000);

  it("la persona puede editar el cambio antes de aprobarlo", async () => {
    const graph = buildHitlGraph({ propose: async () => (await renameProposal()).slice(0, 1), checkpointer: new MemoryCheckpointer<HitlState>() });
    await graph.invoke(initialHitlState("renombrar", workspace), { threadId: "t" });
    const edited = "export const calcPrecio = (b: number, d: number, i: number) => (b - b * d) * (1 + i);\n";
    const final = await graph.resume("t", { resumeValue: { decision: "edit", content: edited } });
    expect(await fs.readFile(path.join(workspace, "src/precios.ts"), "utf-8")).toBe(edited);
    expect(final.testsPassed).toBe(true);
  }, 60_000);

  it("es durable: otro proceso (otro grafo, mismo directorio de checkpoints) retoma la aprobación", async () => {
    const dir = path.join(workspace, ".checkpoints");
    const first = buildHitlGraph({ propose: renameProposal, checkpointer: new FileCheckpointer<HitlState>(dir) });
    await first.invoke(initialHitlState("renombrar", workspace), { threadId: "durable" });
    // "Se reinicia el proceso": el proposer de este grafo nunca debería llamarse.
    const neverCalled = vi.fn(async (): Promise<Change[]> => [] );
    const second = buildHitlGraph({ propose: neverCalled, checkpointer: new FileCheckpointer<HitlState>(dir) });
    await second.resume("durable", { resumeValue: { decision: "approve" } });
    const final = await second.resume("durable", { resumeValue: { decision: "approve" } });
    expect(final.applied).toHaveLength(3);
    expect(neverCalled).not.toHaveBeenCalled();
  }, 60_000);

  it("no acepta propuestas fuera del workspace ni archivos nuevos", async () => {
    for (const file of ["../../escape.ts", "src/nuevo.ts"]) {
      const graph = buildHitlGraph({ propose: async () => [{ file, newContent: "x", reason: "r" }], checkpointer: new MemoryCheckpointer<HitlState>() });
      await expect(graph.invoke(initialHitlState("t", workspace), { threadId: "t" })).rejects.toThrow(/fuera de la carpeta|no existe/);
    }
  });

  it("la política por default pide aprobación para código y no para docs", () => {
    expect(defaultPolicy({ file: "src/a.ts", newContent: "", reason: "" })).toBe(true);
    expect(defaultPolicy({ file: "README.md", newContent: "", reason: "" })).toBe(false);
  });
});
