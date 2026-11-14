/**
 * Estado compartido del orquestador. Es el mismo para los dos motores
 * (grafo propio y LangGraph): lo único que cambia entre versiones es quién
 * ejecuta los nodos y decide el camino.
 */

export interface Plan {
  summary: string;
  /** Archivo de código a implementar, ej: src/slugify.ts */
  sourceFile: string;
  /** Archivo de tests, ej: src/slugify.test.ts */
  testFile: string;
  exports: Array<{ name: string; signature: string; description: string }>;
  testCases: string[];
  acceptanceCriteria: string[];
}

export interface TestReport {
  passed: boolean;
  output: string;
}

export interface Review {
  approved: boolean;
  summary: string;
  issues: string[];
}

export interface OrchestratorState {
  task: string;
  plan: Plan | null;
  /** Cuántas veces trabajó el desarrollador. */
  attempts: number;
  testReport: TestReport | null;
  review: Review | null;
  /** Bitácora de lo que hizo cada agente (se acumula: reducer de append). */
  log: string[];
}

export const initialState = (task: string): OrchestratorState => ({
  task,
  plan: null,
  attempts: 0,
  testReport: null,
  review: null,
  log: [],
});

/** Nombres de los nodos, compartidos por los dos motores. */
export const NODES = {
  architect: "architect",
  tester: "tester",
  developer: "developer",
  runTests: "run_tests",
  reviewer: "reviewer",
} as const;

export type NodeName = (typeof NODES)[keyof typeof NODES];

/** Un nodo: recibe el estado y devuelve solo lo que cambia. */
export type AgentNode = (state: Readonly<OrchestratorState>) => Promise<Partial<OrchestratorState>>;
export type Agents = Record<NodeName, AgentNode>;
