import type { Checkpointer } from "@sandbox/agent-core";
import type { NodeName, OrchestratorState } from "./state.js";

export interface OrchestratorOptions {
  maxAttempts: number;
  threadId: string;
  /** Solo lo usa el motor propio (LangGraph usa su MemorySaver). */
  checkpointer?: Checkpointer<OrchestratorState>;
  onStep?: (node: NodeName, state: OrchestratorState) => void;
}

export interface OrchestratorRun {
  state: OrchestratorState;
  /** Nodos ejecutados, en orden. */
  steps: NodeName[];
}
