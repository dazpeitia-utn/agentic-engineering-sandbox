import type { Comparison } from "./compare.js";
import type { CaseResult, RunReport } from "./types.js";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd = (x: number) => `US$${x.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function formatCase(result: CaseResult): string {
  const head = `${result.pass ? "✅" : "❌"} ${result.caseId}${result.repeat > 1 ? ` #${result.repeat}` : ""} (${secs(result.latencyMs)}, ${usd(result.costUsd)})`;
  if (result.error) return `${head}\n     💥 ${result.error}`;
  const lines = result.scores.map((s) => `     ${s.pass ? "✓" : "✗"} ${s.evaluator} ${s.score.toFixed(2)}: ${s.reason}`);
  return [head, ...lines].join("\n");
}

export function formatReport(report: RunReport): string {
  const s = report.summary;
  const lines = [
    `\n📊 ${report.suite} · variante "${report.variant.name}" · modelo ${report.model} · commit ${report.gitSha}`,
    `   Pass rate: ${pct(s.passRate)} (${report.results.filter((r) => r.pass).length}/${s.runs} corridas, ${s.cases} casos)`,
    `   Costo: ${usd(s.totalCostUsd)} · Latencia p50 ${secs(s.latencyP50Ms)} · p95 ${secs(s.latencyP95Ms)}`,
    "   Evaluadores:",
    ...s.evaluators.map((e) => `     - ${e.evaluator}: pasa ${pct(e.passRate)}, puntaje medio ${e.meanScore.toFixed(2)}`),
  ];
  for (const [judge, a] of Object.entries(s.judgeAgreement ?? {})) {
    lines.push(`   ⚖️ ${judge} vs evaluadores determinísticos: coincide ${pct(a.agreement)} · kappa ${a.kappa.toFixed(2)} (n=${a.n})`);
  }
  return lines.join("\n");
}

export function formatComparison(c: Comparison): string {
  const sign = (x: number) => (x > 0 ? "+" : "");
  const lines = [
    `\n🔀 "${c.before.variant}" (${c.before.sha}) → "${c.after.variant}" (${c.after.sha})`,
    `   Pass rate: ${pct(c.before.passRate)} → ${pct(c.after.passRate)} (${sign(c.passRateDelta)}${(c.passRateDelta * 100).toFixed(0)} pts)`,
    `   Costo: ${usd(c.before.costUsd)} → ${usd(c.after.costUsd)} (${c.costDelta < 0 ? "-" : "+"}${usd(Math.abs(c.costDelta))})`,
    "   Casos:",
    ...c.cases.map((x) => {
      const icon = { improved: "⬆️", regressed: "⬇️", unchanged: "➖", only_before: "◀️", only_after: "▶️" }[x.status];
      return `     ${icon} ${x.caseId}: ${pct(x.before)} → ${pct(x.after)}`;
    }),
  ];
  if (c.regressed.length) lines.push(`   ⚠️ Regresiones: ${c.regressed.join(", ")}`);
  return lines.join("\n");
}
