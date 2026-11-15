/**
 * Compara proveedores/modelos con el eval harness (08): misma suite, mismos casos,
 * distinto modelo. Imprime una tabla con pass rate, costo y latencia.
 *
 *   npm run compare -w 16-multi-provider-agents -- bug-fixer gpt-4o-mini gpt-4o [--repeats 2]
 *   LLM_PROVIDER=anthropic npm run compare -w 16-multi-provider-agents -- bug-fixer claude-haiku-5-5 claude-sonnet-5-5
 */
import { createLLM } from "@sandbox/agent-core";
import { runSuite, saveReport } from "08-eval-harness/runner";
import { SUITES } from "08-eval-harness/suites";

export interface ComparisonRow {
  model: string;
  passRate: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
  runs: number;
}

export function formatTable(rows: ComparisonRow[]): string {
  const best = Math.max(...rows.map((r) => r.passRate));
  const header = "| Modelo | Pass rate | Costo total | Costo por caso aprobado | p50 | p95 |\n|---|---|---|---|---|---|";
  const lines = rows.map((r) => {
    const passed = Math.round(r.passRate * r.runs);
    const perPass = passed ? `US$${(r.costUsd / passed).toFixed(4)}` : "—";
    return `| ${r.model} | ${(r.passRate * 100).toFixed(0)}%${r.passRate === best ? " 🏆" : ""} (${passed}/${r.runs}) | US$${r.costUsd.toFixed(4)} | ${perPass} | ${(r.p50Ms / 1000).toFixed(1)} s | ${(r.p95Ms / 1000).toFixed(1)} s |`;
  });
  return [header, ...lines].join("\n");
}

async function main() {
  const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--repeats");
  const repeats = process.argv.includes("--repeats") ? Number(process.argv[process.argv.indexOf("--repeats") + 1]) : 1;
  const [suiteName, ...models] = args;
  const suite = SUITES[suiteName];
  if (!suite || models.length === 0) throw new Error(`Uso: compare <suite> <modelo1> <modelo2> ... (suites: ${Object.keys(SUITES).join(", ")})`);

  const { client, provider } = await createLLM();
  const rows: ComparisonRow[] = [];
  for (const model of models) {
    console.log(`▶️ ${suiteName} con ${provider}:${model} (${suite.cases.length} casos × ${repeats})...`);
    const report = await runSuite(suite, { model, repeats, client });
    await saveReport(report);
    rows.push({ model: `${provider}:${model}`, passRate: report.summary.passRate, costUsd: report.summary.totalCostUsd, p50Ms: report.summary.latencyP50Ms, p95Ms: report.summary.latencyP95Ms, runs: report.summary.runs });
  }
  console.log(`\n${formatTable(rows)}`);
}

if (process.argv[1]?.endsWith("compare.ts")) {
  main().catch((e) => {
    console.error("❌", e?.message ?? e);
    process.exit(1);
  });
}
