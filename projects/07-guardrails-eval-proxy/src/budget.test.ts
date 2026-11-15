import { describe, expect, it } from "vitest";
import { BudgetTracker, DEFAULT_PRICING, RateLimiter, costOf, priceFor } from "./budget.js";

describe("costos", () => {
  it("calcula el costo según los tokens de entrada y salida", () => {
    // 1M de entrada a 2.5 + 0.5M de salida a 10 = 7.5
    expect(costOf("gpt-4o", { prompt_tokens: 1_000_000, completion_tokens: 500_000 }, DEFAULT_PRICING)).toBeCloseTo(7.5);
  });

  it("reconoce versiones con fecha y no confunde gpt-4o con gpt-4o-mini", () => {
    expect(priceFor("gpt-4o-2024-08-06", DEFAULT_PRICING)).toEqual({ price: DEFAULT_PRICING["gpt-4o"], known: true });
    expect(priceFor("gpt-4o-mini", DEFAULT_PRICING).price).toEqual(DEFAULT_PRICING["gpt-4o-mini"]);
  });

  it("estima modelos desconocidos con el precio más alto", () => {
    expect(priceFor("modelo-nuevo", DEFAULT_PRICING)).toEqual({ price: DEFAULT_PRICING["gpt-4o"], known: false });
  });
});

describe("BudgetTracker", () => {
  const ctx = { agentId: "a", runId: "r1" };

  it("corta la corrida cuando llega al límite", () => {
    const budget = new BudgetTracker({ maxUsdPerRun: 0.1, maxUsdPerAgent: 10 });
    expect(budget.check(ctx).allowed).toBe(true);
    budget.record(ctx, 0.06);
    expect(budget.check(ctx).allowed).toBe(true);
    budget.record(ctx, 0.05);
    expect(budget.check(ctx)).toMatchObject({ allowed: false, reason: expect.stringContaining("r1") });
    // Otra corrida del mismo agente sigue teniendo presupuesto.
    expect(budget.check({ agentId: "a", runId: "r2" }).allowed).toBe(true);
  });

  it("corta al agente cuando suma el límite entre corridas", () => {
    const budget = new BudgetTracker({ maxUsdPerRun: 1, maxUsdPerAgent: 0.15 });
    budget.record({ agentId: "a", runId: "r1" }, 0.1);
    budget.record({ agentId: "a", runId: "r2" }, 0.1);
    expect(budget.check({ agentId: "a", runId: "r3" })).toMatchObject({ allowed: false, reason: expect.stringContaining('agente "a"') });
  });
});

describe("RateLimiter", () => {
  it("limita los requests por minuto por agente", () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    expect(limiter.tryAcquire("a")).toBe(0);
    expect(limiter.tryAcquire("a")).toBe(0);
    expect(limiter.tryAcquire("a")).toBe(60);
    expect(limiter.tryAcquire("b")).toBe(0);
    now = 30_000;
    expect(limiter.tryAcquire("a")).toBe(30);
    now = 60_001;
    expect(limiter.tryAcquire("a")).toBe(0);
  });
});
