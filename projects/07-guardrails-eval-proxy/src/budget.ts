import type { CallContext, Usage } from "./types.js";

/** USD por millón de tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * Precios de referencia (USD / 1M tokens). VERIFICÁ los precios actuales en la
 * página de pricing de OpenAI antes de usarlos para algo más que una estimación;
 * se pueden sobreescribir con la variable PROXY_PRICING (JSON).
 */
export const DEFAULT_PRICING: Record<string, ModelPrice> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

/** Precio de un modelo; acepta versiones con fecha (gpt-4o-2024-08-06 → gpt-4o). */
export function priceFor(model: string, pricing: Record<string, ModelPrice>): { price: ModelPrice; known: boolean } {
  const key = Object.keys(pricing)
    .sort((a, b) => b.length - a.length)
    .find((name) => model === name || model.startsWith(`${name}-`));
  // Modelo desconocido: estimamos con el más caro para no subestimar el gasto.
  if (!key) return { price: Object.values(pricing).reduce((a, b) => (b.input + b.output > a.input + a.output ? b : a)), known: false };
  return { price: pricing[key], known: true };
}

export function costOf(model: string, usage: Usage | undefined, pricing: Record<string, ModelPrice>): number {
  if (!usage) return 0;
  const { price } = priceFor(model, pricing);
  return ((usage.prompt_tokens ?? 0) * price.input + (usage.completion_tokens ?? 0) * price.output) / 1_000_000;
}

export interface BudgetLimits {
  /** Máximo gasto por corrida (x-run-id). */
  maxUsdPerRun: number;
  /** Máximo gasto por agente (x-agent-id), sumando todas sus corridas desde que arrancó el proxy. */
  maxUsdPerAgent: number;
}

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
}

/** Lleva la cuenta del gasto por corrida y por agente, en memoria. */
export class BudgetTracker {
  private byRun = new Map<string, number>();
  private byAgent = new Map<string, number>();

  constructor(private limits: BudgetLimits) {}

  /** Antes de llamar al LLM: ¿todavía queda presupuesto? */
  check({ agentId, runId }: CallContext): BudgetCheck {
    const run = this.byRun.get(runId) ?? 0;
    const agent = this.byAgent.get(agentId) ?? 0;
    if (run >= this.limits.maxUsdPerRun) {
      return { allowed: false, reason: `La corrida "${runId}" gastó US$${run.toFixed(4)} y su límite es US$${this.limits.maxUsdPerRun}.` };
    }
    if (agent >= this.limits.maxUsdPerAgent) {
      return { allowed: false, reason: `El agente "${agentId}" gastó US$${agent.toFixed(4)} y su límite es US$${this.limits.maxUsdPerAgent}.` };
    }
    return { allowed: true };
  }

  /** Después de la llamada: suma el costo real. */
  record({ agentId, runId }: CallContext, usd: number): void {
    this.byRun.set(runId, (this.byRun.get(runId) ?? 0) + usd);
    this.byAgent.set(agentId, (this.byAgent.get(agentId) ?? 0) + usd);
  }

  snapshot() {
    const round = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k, Number(v.toFixed(6))]));
    return { limits: this.limits, byAgent: round(this.byAgent), byRun: round(this.byRun) };
  }
}

/** Ventana deslizante de 60 s: como máximo `maxPerMinute` requests por agente. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private maxPerMinute: number, private now: () => number = Date.now) {}

  /** Devuelve 0 si se permite, o los segundos a esperar. */
  tryAcquire(key: string): number {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.maxPerMinute) {
      this.hits.set(key, recent);
      return Math.ceil((60_000 - (now - recent[0])) / 1000);
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }
}
