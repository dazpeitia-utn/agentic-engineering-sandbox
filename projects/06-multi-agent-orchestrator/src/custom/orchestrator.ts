/**
 * Versión 1: orquestador con el motor de grafos propio de agent-core.
 */
import { END, START, StateGraph, appendReducer, type Checkpointer } from "@sandbox/agent-core";
import { routeAfterReview, routeAfterTests, type Route } from "../routing.js";
import { NODES, type Agents, type NodeName, type OrchestratorState } from "../state.js";
import type { OrchestratorOptions, OrchestratorRun } from "../types.js";

const toEnd = (route: Route) => (route === "end" ? END : route);

export function buildCustomGraph(agents: Agents, maxAttempts: number, checkpointer?: Checkpointer<OrchestratorState>) {
  return new StateGraph<OrchestratorState>({ log: appendReducer })
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
    // 5 nodos fijos + 2 por cada reintento (developer + run_tests) + revisiones intermedias.
    .compile({ maxSteps: 4 + maxAttempts * 3, checkpointer });
}

export async function runCustom(agents: Agents, initial: OrchestratorState, options: OrchestratorOptions): Promise<OrchestratorRun> {
  const graph = buildCustomGraph(agents, options.maxAttempts, options.checkpointer);
  const steps: NodeName[] = [];
  let state = initial;
  for await (const event of graph.stream(initial, { threadId: options.threadId })) {
    steps.push(event.node as NodeName);
    state = event.state;
    options.onStep?.(event.node as NodeName, state);
  }
  return { state, steps };
}
