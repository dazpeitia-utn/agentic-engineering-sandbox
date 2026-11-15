import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI, defaultModel, type ChatClient } from "@sandbox/agent-core";
import { agreement, mean, percentile } from "./stats.js";
import type { CaseContext, CaseResult, EvalCase, RunReport, Score, Suite, Variant } from "./types.js";
import { UsageTracker } from "./usage.js";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNS_DIR = path.join(PROJECT_ROOT, ".runs");
export const REPORTS_DIR = path.join(PROJECT_ROOT, "reports");

export interface RunOptions {
  variant?: string;
  repeats?: number;
  /** Filtra casos por id. */
  only?: string[];
  model?: string;
  /** Cliente base (default: OpenAI real). Los tests le pasan uno falso. */
  client?: ChatClient;
  onCase?: (result: CaseResult, evalCase: EvalCase) => void;
}

function gitSha(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: PROJECT_ROOT }).toString().trim();
    // Con cambios sin commitear, el SHA solo no identifica qué se evaluó.
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "../.."], { cwd: PROJECT_ROOT }).toString().trim() !== "";
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

const slug = (s: string) => s.replace(/[^\w.-]+/g, "_");

/**
 * Corre una suite: para cada caso (y cada repetición) prepara una carpeta
 * aislada, ejecuta el target, aplica los evaluadores y junta las métricas.
 * Un caso que tira error cuenta como fallido, no corta la suite.
 */
export async function runSuite(suite: Suite, options: RunOptions = {}): Promise<RunReport> {
  const variant: Variant = suite.variants.find((v) => v.name === (options.variant ?? suite.variants[0].name)) ??
    (() => { throw new Error(`La suite ${suite.name} no tiene la variante "${options.variant}". Disponibles: ${suite.variants.map((v) => v.name).join(", ")}`); })();
  const repeats = options.repeats ?? 1;
  const model = options.model ?? defaultModel();
  const cases = options.only?.length ? suite.cases.filter((c) => options.only!.includes(c.id)) : suite.cases;
  if (cases.length === 0) throw new Error("No hay casos para correr con ese filtro.");

  const startedAt = new Date().toISOString();
  const runId = `${slug(suite.name)}-${slug(variant.name)}-${startedAt.replace(/[:.]/g, "-")}`;
  const baseClient = options.client ?? (suite.usesLlm ? createOpenAI() : undefined);
  const results: CaseResult[] = [];

  for (const evalCase of cases) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const tracker = new UsageTracker();
      const workspaceDir = path.join(RUNS_DIR, runId, `${slug(evalCase.id)}-${repeat}`);
      await fs.mkdir(workspaceDir, { recursive: true });
      const ctx: CaseContext = {
        workspaceDir,
        client: baseClient ? tracker.wrap(baseClient) : noLlmClient,
        model,
        variant,
      };

      const started = Date.now();
      let scores: Score[] = [];
      let error: string | undefined;
      try {
        await suite.setup?.(evalCase, ctx);
        const output = await suite.run(evalCase, ctx);
        for (const evaluator of suite.evaluators) {
          try {
            scores.push({ ...(await evaluator.evaluate(evalCase, output, ctx)), evaluator: evaluator.name });
          } catch (e: any) {
            scores.push({ evaluator: evaluator.name, score: 0, pass: false, reason: `Error del evaluador: ${e?.message ?? e}` });
          }
        }
      } catch (e: any) {
        error = e?.message ?? String(e);
        scores = [];
      }

      const gating = new Set(suite.evaluators.filter((e) => e.gating !== false).map((e) => e.name));
      const result: CaseResult = {
        caseId: evalCase.id,
        repeat,
        pass: !error && scores.filter((s) => gating.has(s.evaluator)).every((s) => s.pass) && scores.length > 0,
        scores,
        latencyMs: Date.now() - started,
        costUsd: Number(tracker.costUsd.toFixed(6)),
        tokens: { prompt: tracker.promptTokens, completion: tracker.completionTokens },
        error,
      };
      results.push(result);
      options.onCase?.(result, evalCase);
    }
  }

  return {
    suite: suite.name,
    variant,
    model: suite.usesLlm ? model : "n/a",
    gitSha: gitSha(),
    startedAt,
    repeats,
    results,
    summary: summarize(suite, results),
  };
}

export function summarize(suite: Pick<Suite, "evaluators">, results: CaseResult[]): RunReport["summary"] {
  const evaluators = suite.evaluators.map((e) => {
    const scores = results.flatMap((r) => r.scores.filter((s) => s.evaluator === e.name));
    return { evaluator: e.name, meanScore: mean(scores.map((s) => s.score)), passRate: mean(scores.map((s) => (s.pass ? 1 : 0))) };
  });

  // Para cada juez (evaluador no decisivo): ¿coincide con el resultado de los evaluadores decisivos?
  const gating = suite.evaluators.filter((e) => e.gating !== false).map((e) => e.name);
  const judgeAgreement: Record<string, { agreement: number; kappa: number; n: number }> = {};
  for (const judge of suite.evaluators.filter((e) => e.gating === false)) {
    const pairs = results.flatMap((r): Array<[boolean, boolean]> => {
      const j = r.scores.find((s) => s.evaluator === judge.name);
      const refs = r.scores.filter((s) => gating.includes(s.evaluator));
      return j && refs.length ? [[j.pass, refs.every((s) => s.pass)]] : [];
    });
    judgeAgreement[judge.name] = agreement(pairs);
  }

  const latencies = results.map((r) => r.latencyMs);
  return {
    passRate: mean(results.map((r) => (r.pass ? 1 : 0))),
    cases: new Set(results.map((r) => r.caseId)).size,
    runs: results.length,
    totalCostUsd: Number(results.reduce((a, r) => a + r.costUsd, 0).toFixed(6)),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    evaluators,
    ...(Object.keys(judgeAgreement).length ? { judgeAgreement } : {}),
  };
}

export async function saveReport(report: RunReport): Promise<string> {
  const dir = path.join(REPORTS_DIR, slug(report.suite));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${report.startedAt.replace(/[:.]/g, "-")}-${slug(report.variant.name)}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2));
  return file;
}

/** Cliente para suites que no usan LLM: si alguien lo llama, es un bug de la suite. */
const noLlmClient: ChatClient = {
  chat: {
    completions: {
      create: async () => {
        throw new Error("Esta suite está marcada como usesLlm: false y no debería llamar al LLM.");
      },
    },
  },
};
