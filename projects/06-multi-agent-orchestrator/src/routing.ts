import { NODES, type OrchestratorState } from "./state.js";

/** Destino lógico: un nodo o el fin. Cada motor traduce "end" a su propio END. */
export type Route = typeof NODES.developer | typeof NODES.reviewer | "end";

/**
 * Después de correr los tests:
 *  - pasan → revisor;
 *  - fallan y quedan intentos → vuelve al desarrollador con el error;
 *  - fallan sin intentos → revisor igual, para que deje el diagnóstico final.
 */
export function routeAfterTests(state: Readonly<OrchestratorState>, maxAttempts: number): Route {
  if (state.testReport?.passed) return NODES.reviewer;
  return state.attempts < maxAttempts ? NODES.developer : NODES.reviewer;
}

/**
 * Después de la revisión:
 *  - aprobado → fin;
 *  - con observaciones y quedan intentos → desarrollador;
 *  - sin intentos → fin (el resultado queda marcado como no aprobado).
 */
export function routeAfterReview(state: Readonly<OrchestratorState>, maxAttempts: number): Route {
  if (state.review?.approved && state.testReport?.passed) return "end";
  return state.attempts < maxAttempts ? NODES.developer : "end";
}
