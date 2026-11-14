import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  END,
  FileCheckpointer,
  GraphRecursionError,
  MemoryCheckpointer,
  START,
  StateGraph,
  appendReducer,
} from "./graph.js";

interface State {
  count: number;
  log: string[];
}

/** Grafo de prueba: suma de a 1 hasta llegar a `target`, registrando cada paso. */
function counterGraph(target: number) {
  return new StateGraph<State>({ log: appendReducer })
    .addNode("inc", (s) => ({ count: s.count + 1, log: [`inc→${s.count + 1}`] }))
    .addNode("done", () => ({ log: ["done"] }))
    .addEdge(START, "inc")
    .addConditionalEdges("inc", (s) => (s.count >= target ? "done" : "inc"), ["inc", "done"])
    .addEdge("done", END);
}

describe("StateGraph", () => {
  it("recorre el grafo aplicando reducers y aristas condicionales", async () => {
    const final = await counterGraph(3).compile().invoke({ count: 0, log: [] });
    expect(final).toEqual({ count: 3, log: ["inc→1", "inc→2", "inc→3", "done"] });
  });

  it("no muta el estado inicial", async () => {
    const initial = { count: 0, log: [] };
    await counterGraph(2).compile().invoke(initial);
    expect(initial).toEqual({ count: 0, log: [] });
  });

  it("stream emite un evento por nodo con el siguiente destino", async () => {
    const events = [];
    for await (const e of counterGraph(2).compile().stream({ count: 0, log: [] })) events.push([e.node, e.next]);
    expect(events).toEqual([["inc", "inc"], ["inc", "done"], ["done", END]]);
  });

  it("corta los ciclos infinitos con maxSteps", async () => {
    await expect(counterGraph(100).compile({ maxSteps: 5 }).invoke({ count: 0, log: [] })).rejects.toBeInstanceOf(GraphRecursionError);
  });

  it("valida el grafo al compilar", () => {
    expect(() => new StateGraph<State>().addNode("a", () => ({})).compile()).toThrow(/arista de entrada/);
    expect(() => new StateGraph<State>().addNode("a", () => ({})).addEdge(START, "a").compile()).toThrow(/no tiene arista de salida/);
    expect(() => new StateGraph<State>().addEdge(START, "fantasma").compile()).toThrow(/inexistente/);
  });

  it("falla si el router devuelve un destino no declarado", async () => {
    const graph = new StateGraph<State>()
      .addNode("a", () => ({}))
      .addEdge(START, "a")
      .addConditionalEdges("a", () => "otro", ["a"])
      .compile();
    await expect(graph.invoke({ count: 0, log: [] })).rejects.toThrow(/inexistente|no está declarado/);
  });

  it("guarda checkpoints y retoma una corrida cortada", async () => {
    const checkpointer = new MemoryCheckpointer<State>();
    let fail = true;
    const graph = new StateGraph<State>({ log: appendReducer })
      .addNode("uno", () => ({ log: ["uno"] }))
      .addNode("dos", () => {
        if (fail) throw new Error("se cortó");
        return { log: ["dos"] };
      })
      .addEdge(START, "uno")
      .addEdge("uno", "dos")
      .addEdge("dos", END)
      .compile({ checkpointer });

    await expect(graph.invoke({ count: 0, log: [] }, { threadId: "t1" })).rejects.toThrow("se cortó");
    expect(await checkpointer.load("t1")).toMatchObject({ step: 1, next: "dos", history: ["uno"] });

    fail = false;
    const final = await graph.resume("t1");
    expect(final.log).toEqual(["uno", "dos"]);
    expect(await checkpointer.load("t1")).toMatchObject({ next: END, history: ["uno", "dos"] });
  });

  it("FileCheckpointer persiste en JSON y valida el threadId", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ckpt-"));
    const checkpointer = new FileCheckpointer<State>(dir);
    await counterGraph(1).compile({ checkpointer }).invoke({ count: 0, log: [] }, { threadId: "run-1" });
    const saved = JSON.parse(await fs.readFile(path.join(dir, "run-1.json"), "utf-8"));
    expect(saved).toMatchObject({ next: END, history: ["inc", "done"], state: { count: 1 } });
    await expect(checkpointer.load("../escape")).rejects.toThrow(/threadId inválido/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
