import { describe, expect, it, vi } from "vitest";
import { slugifyFixturesSuite, changedLines } from "../suites/index.js";
import { compareReports } from "./compare.js";
import { runSuite } from "./runner.js";
import { agreement, percentile } from "./stats.js";
import type { Evaluator, RunReport, Suite } from "./types.js";

/** Suite de juguete: el "agente" duplica un número; el evaluador chequea el resultado. */
function toySuite(agent: (x: number) => number, judge?: Evaluator<number, number>): Suite<number, number> {
  return {
    name: "toy",
    description: "duplicar",
    usesLlm: false,
    variants: [{ name: "v1" }, { name: "v2" }],
    cases: [1, 2, 3].map((n) => ({ id: `n${n}`, description: "", input: n })),
    run: async (c) => agent(c.input),
    evaluators: [
      { name: "exacto", evaluate: async (c, out) => ({ evaluator: "exacto", score: out === c.input * 2 ? 1 : 0, pass: out === c.input * 2, reason: `${out}` }) },
      ...(judge ? [judge] : []),
    ],
  };
}

describe("runSuite", () => {
  it("calcula pass rate y puntajes por evaluador", async () => {
    const report = await runSuite(toySuite((x) => (x === 3 ? 0 : x * 2)));
    expect(report.summary).toMatchObject({ passRate: 2 / 3, cases: 3, runs: 3, totalCostUsd: 0 });
    expect(report.summary.evaluators).toEqual([{ evaluator: "exacto", meanScore: 2 / 3, passRate: 2 / 3 }]);
  });

  it("un caso que tira error cuenta como fallido y no corta la suite", async () => {
    const report = await runSuite(toySuite((x) => {
      if (x === 2) throw new Error("boom");
      return x * 2;
    }));
    expect(report.results.map((r) => [r.caseId, r.pass, r.error])).toEqual([["n1", true, undefined], ["n2", false, "boom"], ["n3", true, undefined]]);
  });

  it("repite casos, filtra por id y elige variante", async () => {
    const report = await runSuite(toySuite((x) => x * 2), { repeats: 2, only: ["n1"], variant: "v2" });
    expect(report.results).toHaveLength(2);
    expect(report.variant.name).toBe("v2");
    await expect(runSuite(toySuite((x) => x), { variant: "nope" })).rejects.toThrow(/no tiene la variante/);
  });

  it("un juez no decisivo no cambia el resultado, pero se mide su coincidencia", async () => {
    // Juez que siempre aprueba: coincide en los casos buenos y se equivoca en el malo.
    const judge: Evaluator<number, number> = { name: "juez", gating: false, evaluate: async () => ({ evaluator: "juez", score: 1, pass: true, reason: "ok" }) };
    const report = await runSuite(toySuite((x) => (x === 3 ? 0 : x * 2), judge));
    expect(report.summary.passRate).toBe(2 / 3);
    expect(report.summary.judgeAgreement?.juez).toMatchObject({ agreement: 2 / 3, n: 3 });
  });

  it("las suites sin LLM no pueden llamar a la API", async () => {
    const suite: Suite<number, number> = {
      ...toySuite((x) => x),
      run: async (_c, ctx) => {
        await ctx.client.chat.completions.create({ model: "m", messages: [] });
        return 0;
      },
    };
    const report = await runSuite(suite);
    expect(report.results[0].error).toMatch(/usesLlm: false/);
  });

  it("cuenta el costo de las llamadas al LLM de cada caso", async () => {
    const client = {
      chat: { completions: { create: vi.fn(async () => ({ choices: [], usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }) as any) } },
    };
    const suite: Suite<number, number> = {
      ...toySuite((x) => x * 2),
      usesLlm: true,
      run: async (c, ctx) => {
        await ctx.client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
        return c.input * 2;
      },
    };
    const report = await runSuite(suite, { client, model: "gpt-4o-mini" });
    // 1M de tokens de entrada de gpt-4o-mini = US$0.15 por caso.
    expect(report.results[0]).toMatchObject({ costUsd: 0.15, tokens: { prompt: 1_000_000, completion: 0 } });
    expect(report.summary.totalCostUsd).toBeCloseTo(0.45);
  });
});

describe("compareReports", () => {
  const report = (variant: string, passes: Record<string, boolean[]>, cost = 0): RunReport => ({
    suite: "s",
    variant: { name: variant },
    model: "m",
    gitSha: "abc",
    startedAt: "",
    repeats: 1,
    results: Object.entries(passes).flatMap(([caseId, ps]) => ps.map((pass, i) => ({ caseId, repeat: i + 1, pass, scores: [], latencyMs: 0, costUsd: 0, tokens: { prompt: 0, completion: 0 } }))),
    summary: { passRate: Object.values(passes).flat().filter(Boolean).length / Object.values(passes).flat().length, cases: 0, runs: 0, totalCostUsd: cost, latencyP50Ms: 0, latencyP95Ms: 0, evaluators: [] },
  });

  it("detecta mejoras y regresiones por caso", () => {
    const c = compareReports(report("a", { x: [false, false], y: [true, true], z: [true, false] }, 1), report("b", { x: [true, false], y: [false, true], z: [true, false] }, 1.5));
    expect(c.improved).toEqual(["x"]);
    expect(c.regressed).toEqual(["y"]);
    expect(c.cases.find((k) => k.caseId === "z")?.status).toBe("unchanged");
    expect(c.costDelta).toBeCloseTo(0.5);
  });

  it("no compara suites distintas", () => {
    expect(() => compareReports(report("a", {}), { ...report("b", {}), suite: "otra" })).toThrow(/suites distintas/);
  });
});

describe("estadísticas", () => {
  it("percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });

  it("kappa de Cohen: 1 si coincide siempre, ~0 si coincide por azar", () => {
    expect(agreement([[true, true], [false, false], [true, true], [false, false]])).toMatchObject({ agreement: 1, kappa: 1 });
    // Un juez que siempre dice "pasa" coincide en 50% pero no aporta información.
    expect(agreement([[true, true], [true, false], [true, true], [true, false]]).kappa).toBe(0);
  });
});

describe("suite slugify-fixtures (sin API)", () => {
  it("el evaluador detecta los dos bugs reales del 06 y aprueba la referencia", async () => {
    const report = await runSuite(slugifyFixturesSuite);
    const verdicts = Object.fromEntries(report.results.map((r) => [r.caseId, r.pass]));
    for (const c of slugifyFixturesSuite.cases) expect(verdicts[c.id], c.id).toBe(c.input.expectedPass);

    const reasons = Object.fromEntries(report.results.map((r) => [r.caseId, r.scores[0].reason]));
    expect(reasons["buggy-06-langgraph"]).toMatch(/ignora_acentos/);
    expect(reasons["custom-06"]).toMatch(/"_"/);
  });
});

it("changedLines cuenta las líneas que cambian", () => {
  expect(changedLines("a\nb\nc", "a\nB\nc")).toBe(1);
  expect(changedLines("a\nb", "a\nb")).toBe(0);
  expect(changedLines("a", "a\nx\ny")).toBe(2);
});
