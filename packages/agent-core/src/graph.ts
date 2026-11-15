import fs from "node:fs/promises";
import path from "node:path";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { tracer, withSpan } from "./tracing.js";

/**
 * Motor de grafos de estado mínimo, inspirado en LangGraph:
 *  - un estado compartido que viaja por el grafo,
 *  - nodos que devuelven solo la parte del estado que cambian,
 *  - reducers que definen cómo se combina cada actualización,
 *  - aristas fijas y condicionales (routing según el estado),
 *  - límite de pasos y checkpoints para retomar una corrida.
 */

export const START = "__start__";
export const END = "__end__";

/** Cómo combinar el valor actual de un campo con una actualización. Default: reemplazar. */
export type Reducer<T> = (current: T, update: T) => T;
export type Reducers<S> = { [K in keyof S]?: Reducer<S[K]> };

/**
 * Lo que recibe cada nodo además del estado. `interrupt(payload)` pausa el grafo
 * (human-in-the-loop): se guarda un checkpoint y la corrida se detiene. Al hacer
 * `resume(threadId, valor)`, el nodo se vuelve a ejecutar desde el principio y esta
 * vez `interrupt()` devuelve `valor`. Por eso el código antes del interrupt debe ser
 * barato y sin efectos (igual que en LangGraph).
 */
export interface NodeContext {
  interrupt<T = unknown>(payload: unknown): T;
}

export type NodeFn<S> = (state: Readonly<S>, ctx: NodeContext) => Promise<Partial<S>> | Partial<S>;

/** Señal interna: un nodo pidió pausar. */
export class NodeInterrupt extends Error {
  constructor(public payload: unknown) {
    super("El nodo pidió una interrupción (human-in-the-loop).");
  }
}
export type Router<S> = (state: Readonly<S>) => string;

/** Reducer para listas: agrega en vez de reemplazar (como `messages` en LangGraph). */
export const appendReducer = <T>(current: T[] = [], update: T[] = []): T[] => [...current, ...update];

export interface Checkpoint<S> {
  threadId: string;
  step: number;
  /** Próximo nodo a ejecutar (END si la corrida terminó). */
  next: string;
  state: S;
  /** Historial de nodos ejecutados, en orden. */
  history: string[];
  updatedAt: string;
  /** running: en curso o cortada; interrupted: esperando a una persona; done: terminó. */
  status?: "running" | "interrupted" | "done";
  /** Qué está esperando la corrida pausada. */
  interrupt?: { node: string; payload: unknown };
  /** Respuestas ya dadas a los interrupt() del nodo pendiente, en orden. */
  resumeValues?: unknown[];
}

export interface Checkpointer<S> {
  save(checkpoint: Checkpoint<S>): Promise<void>;
  load(threadId: string): Promise<Checkpoint<S> | null>;
}

/** Checkpoints en memoria (útil para tests). */
export class MemoryCheckpointer<S> implements Checkpointer<S> {
  private store = new Map<string, Checkpoint<S>>();
  async save(checkpoint: Checkpoint<S>) {
    this.store.set(checkpoint.threadId, structuredClone(checkpoint));
  }
  async load(threadId: string) {
    const c = this.store.get(threadId);
    return c ? structuredClone(c) : null;
  }
}

/** Checkpoints en archivos JSON: `<dir>/<threadId>.json`. Permite inspeccionar y retomar corridas. */
export class FileCheckpointer<S> implements Checkpointer<S> {
  constructor(private dir: string) {}
  private file(threadId: string) {
    if (!/^[\w.-]+$/.test(threadId)) throw new Error(`threadId inválido: "${threadId}"`);
    return path.join(this.dir, `${threadId}.json`);
  }
  async save(checkpoint: Checkpoint<S>) {
    await fs.mkdir(this.dir, { recursive: true });
    // Escritura atómica: si el proceso muere a la mitad, el checkpoint anterior queda intacto.
    const file = this.file(checkpoint.threadId);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(checkpoint, null, 2));
    await fs.rename(tmp, file);
  }
  async load(threadId: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(threadId), "utf-8")) as Checkpoint<S>;
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
}

export class GraphRecursionError extends Error {
  constructor(maxSteps: number, public lastNode: string) {
    super(`El grafo superó el máximo de ${maxSteps} pasos (último nodo: ${lastNode}).`);
  }
}

export interface StepEvent<S> {
  step: number;
  node: string;
  update: Partial<S>;
  state: S;
  next: string;
  /** Si el nodo pidió una interrupción: lo que espera. La corrida queda pausada. */
  interrupt?: unknown;
}

export interface RunOptions<S> {
  /** Identificador de la corrida para los checkpoints. */
  threadId?: string;
  onStep?: (event: StepEvent<S>) => void;
}

type Edge<S> = { kind: "fixed"; to: string } | { kind: "conditional"; router: Router<S>; targets?: string[] };

export class StateGraph<S extends object> {
  private nodes = new Map<string, NodeFn<S>>();
  private edges = new Map<string, Edge<S>>();

  constructor(private reducers: Reducers<S> = {}) {}

  addNode(name: string, fn: NodeFn<S>): this {
    if (name === START || name === END) throw new Error(`"${name}" es un nombre reservado.`);
    if (this.nodes.has(name)) throw new Error(`El nodo "${name}" ya existe.`);
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.setEdge(from, { kind: "fixed", to });
    return this;
  }

  /** `targets` (opcional) declara los destinos posibles para validarlos al compilar. */
  addConditionalEdges(from: string, router: Router<S>, targets?: string[]): this {
    this.setEdge(from, { kind: "conditional", router, targets });
    return this;
  }

  compile(options: { maxSteps?: number; checkpointer?: Checkpointer<S> } = {}): CompiledGraph<S> {
    if (!this.edges.has(START)) throw new Error("Falta la arista de entrada: addEdge(START, ...).");
    const known = (n: string) => n === END || this.nodes.has(n);
    for (const [from, edge] of this.edges) {
      if (from !== START && !this.nodes.has(from)) throw new Error(`Arista desde un nodo inexistente: "${from}".`);
      const targets = edge.kind === "fixed" ? [edge.to] : (edge.targets ?? []);
      for (const t of targets) if (!known(t)) throw new Error(`Arista hacia un nodo inexistente: "${from}" → "${t}".`);
    }
    for (const name of this.nodes.keys()) {
      if (!this.edges.has(name)) throw new Error(`El nodo "${name}" no tiene arista de salida.`);
    }
    return new CompiledGraph(this.nodes, this.edges, this.reducers, options.maxSteps ?? 25, options.checkpointer);
  }

  private setEdge(from: string, edge: Edge<S>) {
    if (from === END) throw new Error("END no puede tener aristas de salida.");
    if (this.edges.has(from)) throw new Error(`"${from}" ya tiene una arista de salida.`);
    this.edges.set(from, edge);
  }
}

export class CompiledGraph<S extends object> {
  constructor(
    private nodes: Map<string, NodeFn<S>>,
    private edges: Map<string, Edge<S>>,
    private reducers: Reducers<S>,
    private maxSteps: number,
    private checkpointer?: Checkpointer<S>,
  ) {}

  /** Corre el grafo desde START con el estado inicial y devuelve el estado final. */
  async invoke(initial: S, options: RunOptions<S> = {}): Promise<S> {
    let last = initial;
    for await (const event of this.stream(initial, options)) last = event.state;
    return last;
  }

  /** Igual que invoke, pero emite un evento por cada nodo ejecutado. */
  async *stream(initial: S, options: RunOptions<S> = {}): AsyncGenerator<StepEvent<S>> {
    const first = this.nextNode(START, initial);
    const state = structuredClone(initial);
    // Checkpoint inicial: si el proceso muere durante el primer nodo, la corrida igual se puede retomar.
    if (this.checkpointer && options.threadId) {
      await this.checkpointer.save({ threadId: options.threadId, step: 0, next: first, state, history: [], updatedAt: new Date().toISOString(), status: "running" });
    }
    yield* this.run({ state, next: first, step: 0, history: [] }, options);
  }

  /**
   * Retoma una corrida desde su último checkpoint: si se cortó a la mitad, o si
   * estaba pausada esperando a una persona (en ese caso `resumeValue` es su respuesta).
   */
  async resume(threadId: string, options: Omit<RunOptions<S>, "threadId"> & { resumeValue?: unknown } = {}): Promise<S> {
    let last: S | undefined;
    for await (const event of this.resumeStream(threadId, options)) last = event.state;
    return last ?? (await this.getState(threadId))!.state;
  }

  async *resumeStream(threadId: string, { resumeValue, ...options }: Omit<RunOptions<S>, "threadId"> & { resumeValue?: unknown } = {}): AsyncGenerator<StepEvent<S>> {
    if (!this.checkpointer) throw new Error("Para retomar hace falta un checkpointer.");
    const checkpoint = await this.checkpointer.load(threadId);
    if (!checkpoint) throw new Error(`No hay checkpoint para "${threadId}".`);
    if (checkpoint.status === "done" || checkpoint.next === END) return;
    const resumeValues = checkpoint.status === "interrupted" ? [...(checkpoint.resumeValues ?? []), resumeValue] : (checkpoint.resumeValues ?? []);
    yield* this.run(checkpoint, { ...options, threadId }, resumeValues);
  }

  /** Último checkpoint de una corrida (para ver si está pausada y qué espera). */
  async getState(threadId: string): Promise<Checkpoint<S> | null> {
    if (!this.checkpointer) throw new Error("getState necesita un checkpointer.");
    return this.checkpointer.load(threadId);
  }

  private async *run(
    from: { state: S; next: string; step: number; history: string[] },
    { threadId, onStep }: RunOptions<S>,
    resumeValues: unknown[] = [],
  ): AsyncGenerator<StepEvent<S>> {
    let { state, next, step } = from;
    const history = [...from.history];
    // Span raíz de la corrida. Es un generador: el contexto activo no sobrevive entre yields,
    // así que cada nodo se ejecuta explícitamente dentro del contexto de este span.
    const runSpan = tracer.startSpan(resumeValues.length || from.step > 0 ? "graph.resume" : "graph.run", { attributes: { "graph.thread_id": threadId ?? "", "graph.start_node": next, "graph.start_step": step } });
    const runContext = trace.setSpan(context.active(), runSpan);
    let runError: unknown;
    try {
      yield* this.runSteps({ state, next, step, history }, { threadId, onStep }, resumeValues, runContext);
    } catch (error) {
      runError = error;
      throw error;
    } finally {
      if (runError) {
        runSpan.recordException(runError as Error);
        runSpan.setStatus({ code: SpanStatusCode.ERROR, message: (runError as Error)?.message });
      }
      runSpan.end();
    }
  }

  private async *runSteps(
    from: { state: S; next: string; step: number; history: string[] },
    { threadId, onStep }: RunOptions<S>,
    resumeValues: unknown[],
    runContext: ReturnType<typeof context.active>,
  ): AsyncGenerator<StepEvent<S>> {
    let { state, next, step } = from;
    const history = from.history;
    const save = async (extra: Partial<Checkpoint<S>>) => {
      if (this.checkpointer && threadId) {
        await this.checkpointer.save({ threadId, step, next, state, history, updatedAt: new Date().toISOString(), ...extra });
      }
    };

    while (next !== END) {
      if (step >= this.maxSteps) throw new GraphRecursionError(this.maxSteps, history.at(-1) ?? START);
      const node = next;
      let calls = 0;
      const ctx: NodeContext = {
        interrupt: <T>(payload: unknown): T => {
          const index = calls++;
          if (index < resumeValues.length) return resumeValues[index] as T;
          throw new NodeInterrupt(payload);
        },
      };

      let update: Partial<S>;
      try {
        update = await context.with(runContext, () => withSpan(`graph.node ${node}`, { "graph.node": node, "graph.step": step, "graph.thread_id": threadId ?? "" }, async (span) => {
          try {
            return (await this.nodes.get(node)!(state, ctx)) ?? {};
          } catch (error) {
            // Una interrupción no es un error: el span termina OK con el evento.
            if (error instanceof NodeInterrupt) {
              span.addEvent("graph.interrupt");
              span.setAttribute("graph.interrupted", true);
            }
            throw error;
          }
        }));
      } catch (error) {
        if (!(error instanceof NodeInterrupt)) throw error;
        if (!this.checkpointer || !threadId) throw new Error("interrupt() necesita un checkpointer y un threadId para poder retomar.");
        await save({ status: "interrupted", interrupt: { node, payload: error.payload }, resumeValues });
        const event: StepEvent<S> = { step, node, update: {}, state, next: node, interrupt: error.payload };
        onStep?.(event);
        yield event;
        return;
      }

      resumeValues = [];
      state = this.applyUpdate(state, update);
      step++;
      history.push(node);
      next = this.nextNode(node, state);
      await save({ status: next === END ? "done" : "running" });
      const event: StepEvent<S> = { step, node, update, state, next };
      onStep?.(event);
      yield event;
    }
  }

  private applyUpdate(state: S, update: Partial<S>): S {
    const merged = { ...state };
    for (const key of Object.keys(update) as Array<keyof S>) {
      const value = update[key] as S[keyof S];
      const reducer = this.reducers[key];
      merged[key] = reducer ? reducer(state[key], value) : value;
    }
    return merged;
  }

  private nextNode(from: string, state: S): string {
    const edge = this.edges.get(from)!;
    if (edge.kind === "fixed") return edge.to;
    const target = edge.router(state);
    if (target !== END && !this.nodes.has(target)) throw new Error(`El router de "${from}" devolvió un nodo inexistente: "${target}".`);
    if (edge.targets && !edge.targets.includes(target)) throw new Error(`El router de "${from}" devolvió "${target}", que no está declarado.`);
    return target;
  }
}
