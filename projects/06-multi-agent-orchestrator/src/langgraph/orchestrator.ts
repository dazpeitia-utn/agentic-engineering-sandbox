/**
 * Versión 2: el mismo orquestador con LangGraph.js.
 *
 * Diferencias con el motor propio:
 *  - El estado se declara con `Annotation.Root`; cada campo puede tener su reducer y su default.
 *  - El límite de pasos es `recursionLimit` y se pasa al invocar, no al compilar.
 *  - Los checkpoints van por `thread_id` con un checkpointer de LangGraph (acá `MemorySaver`);
 *    con eso se puede consultar el estado (`getState`) o pausar con `interrupt()` (human-in-the-loop).
 */
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { routeAfterReview, routeAfterTests, type Route } from "../routing.js";
import { NODES, type Agents, type NodeName, type OrchestratorState, type Plan, type Review, type TestReport } from "../state.js";
import type { OrchestratorOptions, OrchestratorRun } from "../types.js";

/** El mismo OrchestratorState, declarado al estilo LangGraph. */
export const OrchestratorAnnotation = Annotation.Root({
  task: Annotation<string>,
  plan: Annotation<Plan | null>,
  attempts: Annotation<number>,
  testReport: Annotation<TestReport | null>,
  review: Annotation<Review | null>,
  log: Annotation<string[]>({ reducer: (current, update) => current.concat(update), default: () => [] }),
});

const toEnd = (route: Route) => (route === "end" ? END : route);

export function buildLangGraph(agents: Agents, maxAttempts: number) {
  return new StateGraph(OrchestratorAnnotation)
    .addNode(NODES.architect, agents.architect)
    .addNode(NODES.tester, agents.tester)
    .addNode(NODES.developer, agents.developer)
    .addNode(NODES.runTests, agents.run_tests)
    .addNode(NODES.reviewer, agents.reviewer)
    .addEdge(START, NODES.architect)
    .addEdge(NODES.architect, NODES.tester)
    .addEdge(NODES.tester, NODES.developer)
    .addEdge(NODES.developer, NODES.runTests)
    .addConditionalEdges(NODES.runTests, (s) => toEnd(routeAfterTests(s, maxAttempts)), [NODES.developer, NODES.reviewer])
    .addConditionalEdges(NODES.reviewer, (s) => toEnd(routeAfterReview(s, maxAttempts)), [NODES.developer, END])
    .compile({ checkpointer: new MemorySaver() });
}

export async function runLangGraph(agents: Agents, initial: OrchestratorState, options: OrchestratorOptions): Promise<OrchestratorRun> {
  const graph = buildLangGraph(agents, options.maxAttempts);
  const config = { configurable: { thread_id: options.threadId }, recursionLimit: 4 + options.maxAttempts * 3 };
  const steps: NodeName[] = [];

  // streamMode "updates": un evento por nodo, con solo lo que ese nodo cambió.
  for await (const chunk of await graph.stream(initial, { ...config, streamMode: "updates" })) {
    for (const node of Object.keys(chunk) as NodeName[]) {
      steps.push(node);
      const snapshot = await graph.getState(config);
      options.onStep?.(node, snapshot.values as OrchestratorState);
    }
  }

  // El checkpointer guardó el estado final por thread_id.
  const final = await graph.getState(config);
  return { state: final.values as OrchestratorState, steps };
}
