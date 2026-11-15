/**
 * CLI del eval harness.
 *
 *   npm run evals -w 08-eval-harness -- list
 *   npm run evals -w 08-eval-harness -- run <suite> [--variant v] [--repeats n] [--only id1,id2] [--model m]
 *   npm run evals -w 08-eval-harness -- compare <reporte-antes.json> <reporte-despues.json>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { compareReports } from "./core/compare.js";
import { formatCase, formatComparison, formatReport } from "./core/format.js";
import { runSuite, saveReport } from "./core/runner.js";
import type { RunReport } from "./core/types.js";
import { SUITES } from "./suites/index.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "list") {
    console.log("Suites disponibles:\n");
    for (const s of Object.values(SUITES)) {
      console.log(`  ${s.name}${s.usesLlm ? " 💲" : ""}: ${s.description}`);
      console.log(`     ${s.cases.length} casos · variantes: ${s.variants.map((v) => v.name).join(", ")}`);
    }
    console.log("\n💲 = llama a la API (cuesta plata)");
    return;
  }

  if (command === "run") {
    const suite = SUITES[args[0]];
    if (!suite) throw new Error(`Suite desconocida "${args[0]}". Usá: list`);
    const repeats = Number(flag(args, "repeats") ?? 1);
    console.log(`▶️ ${suite.name}: ${suite.cases.length} casos × ${repeats} repetición(es)${suite.usesLlm ? " (usa la API)" : ""}\n`);
    const report = await runSuite(suite, {
      variant: flag(args, "variant"),
      repeats,
      only: flag(args, "only")?.split(","),
      model: flag(args, "model"),
      onCase: (result) => console.log(formatCase(result)),
    });
    console.log(formatReport(report));
    console.log(`\n💾 Reporte: ${path.relative(process.cwd(), await saveReport(report))}`);
    process.exitCode = report.summary.passRate === 1 ? 0 : 1;
    return;
  }

  if (command === "compare") {
    const [a, b] = args;
    if (!a || !b) throw new Error("Uso: compare <reporte-antes.json> <reporte-despues.json>");
    const load = async (f: string) => JSON.parse(await fs.readFile(f, "utf-8")) as RunReport;
    const comparison = compareReports(await load(a), await load(b));
    console.log(formatComparison(comparison));
    process.exitCode = comparison.regressed.length > 0 ? 1 : 0;
    return;
  }

  throw new Error(`Comando desconocido "${command}". Comandos: list, run, compare.`);
}

main().catch((error) => {
  console.error("❌", error?.message ?? error);
  process.exit(1);
});
