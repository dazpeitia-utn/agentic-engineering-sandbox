import { mean } from "./stats.js";
import type { RunReport } from "./types.js";

export interface CaseComparison {
  caseId: string;
  /** Proporción de repeticiones que pasaron (0..1) en cada corrida. */
  before: number;
  after: number;
  status: "improved" | "regressed" | "unchanged" | "only_before" | "only_after";
}

export interface Comparison {
  before: { variant: string; passRate: number; costUsd: number; sha: string };
  after: { variant: string; passRate: number; costUsd: number; sha: string };
  passRateDelta: number;
  costDelta: number;
  cases: CaseComparison[];
  improved: string[];
  regressed: string[];
}

const passRateByCase = (report: RunReport) => {
  const byCase = new Map<string, boolean[]>();
  for (const r of report.results) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r.pass]);
  return new Map([...byCase].map(([id, passes]) => [id, mean(passes.map((p) => (p ? 1 : 0)))]));
};

/** Compara dos corridas de la misma suite: qué casos mejoraron, cuáles empeoraron y cuánto cambió el costo. */
export function compareReports(before: RunReport, after: RunReport): Comparison {
  if (before.suite !== after.suite) throw new Error(`No se pueden comparar suites distintas: ${before.suite} vs ${after.suite}`);
  const a = passRateByCase(before);
  const b = passRateByCase(after);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort();

  const cases: CaseComparison[] = ids.map((caseId) => {
    const x = a.get(caseId);
    const y = b.get(caseId);
    if (x === undefined) return { caseId, before: 0, after: y!, status: "only_after" };
    if (y === undefined) return { caseId, before: x, after: 0, status: "only_before" };
    return { caseId, before: x, after: y, status: y > x ? "improved" : y < x ? "regressed" : "unchanged" };
  });

  const side = (r: RunReport) => ({ variant: r.variant.name, passRate: r.summary.passRate, costUsd: r.summary.totalCostUsd, sha: r.gitSha });
  return {
    before: side(before),
    after: side(after),
    passRateDelta: after.summary.passRate - before.summary.passRate,
    costDelta: after.summary.totalCostUsd - before.summary.totalCostUsd,
    cases,
    improved: cases.filter((c) => c.status === "improved").map((c) => c.caseId),
    regressed: cases.filter((c) => c.status === "regressed").map((c) => c.caseId),
  };
}
