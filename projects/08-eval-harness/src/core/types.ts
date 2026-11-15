import type { ChatClient } from "@sandbox/agent-core";

/** Un caso del dataset: una entrada para el agente y lo que se espera de él. */
export interface EvalCase<Input = unknown> {
  id: string;
  description: string;
  input: Input;
  tags?: string[];
}

/** Puntaje de un evaluador sobre un caso. `score` va de 0 a 1. */
export interface Score {
  evaluator: string;
  score: number;
  pass: boolean;
  reason: string;
  /** Datos extra para el reporte (ej: el contraejemplo de una propiedad). */
  details?: Record<string, unknown>;
}

/** Lo que el harness le da al target para cada caso. */
export interface CaseContext {
  /** Carpeta aislada del caso (dentro del monorepo, para que Vitest resuelva sus dependencias). */
  workspaceDir: string;
  /** Cliente que cuenta tokens y costo; los targets que llaman al LLM deben usarlo. */
  client: ChatClient;
  model: string;
  variant: Variant;
}

/** Variante de lo que se evalúa (prompt, modelo, motor...). Permite comparar dos versiones. */
export interface Variant {
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface Evaluator<Input, Output> {
  name: string;
  /** Si es false, el evaluador informa pero no decide si el caso pasa (ej: el LLM judge que estamos validando). */
  gating?: boolean;
  evaluate(evalCase: EvalCase<Input>, output: Output, ctx: CaseContext): Promise<Score>;
}

export interface Suite<Input = any, Output = any> {
  name: string;
  description: string;
  /** true si la suite llama a la API (cuesta plata). */
  usesLlm: boolean;
  cases: EvalCase<Input>[];
  variants: Variant[];
  /** Prepara la carpeta del caso (copia fixtures, etc.). */
  setup?(evalCase: EvalCase<Input>, ctx: CaseContext): Promise<void>;
  /** Corre lo que se evalúa: normalmente un agente. */
  run(evalCase: EvalCase<Input>, ctx: CaseContext): Promise<Output>;
  evaluators: Evaluator<Input, Output>[];
}

export interface CaseResult {
  caseId: string;
  repeat: number;
  pass: boolean;
  scores: Score[];
  latencyMs: number;
  costUsd: number;
  tokens: { prompt: number; completion: number };
  error?: string;
}

export interface EvaluatorSummary {
  evaluator: string;
  meanScore: number;
  passRate: number;
}

export interface RunReport {
  suite: string;
  variant: Variant;
  model: string;
  gitSha: string;
  startedAt: string;
  repeats: number;
  results: CaseResult[];
  summary: {
    passRate: number;
    cases: number;
    runs: number;
    totalCostUsd: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    evaluators: EvaluatorSummary[];
    /** Coincidencia entre evaluadores no decisivos (jueces) y los decisivos. */
    judgeAgreement?: Record<string, { agreement: number; kappa: number; n: number }>;
  };
}
