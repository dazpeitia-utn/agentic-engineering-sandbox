import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { loadEnv, requireEnv } from "@sandbox/agent-core";
import { BudgetTracker, DEFAULT_PRICING, RateLimiter, type ModelPrice } from "./budget.js";
import {
  jsonSchemaOutputGuard,
  llmInjectionClassifierGuard,
  piiGuardOptions,
  promptInjectionGuard,
  secretsGuardOptions,
  sensitiveDataInputGuard,
  sensitiveDataOutputGuard,
  type InputGuard,
} from "./guards/index.js";
import { JsonlLogger } from "./logger.js";
import type { ProxyDeps } from "./proxy.js";
import { createHttpUpstream } from "./server.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface ProxyConfig {
  host: string;
  port: number;
  upstreamURL: string;
  token?: string;
  maxUsdPerRun: number;
  maxUsdPerAgent: number;
  maxRequestsPerMinute: number;
  llmClassifier: boolean;
  classifierModel: string;
  logDir: string;
  pricing: Record<string, ModelPrice>;
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Configuración por variables de entorno (todas con default razonable). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  loadEnv();
  return {
    // Por default solo escucha en localhost: no queda expuesto en la red.
    host: env.PROXY_HOST ?? "127.0.0.1",
    port: num(env.PROXY_PORT, 8787),
    // Ojo: NO usamos OPENAI_BASE_URL acá, porque los agentes la apuntan al proxy y se llamaría a sí mismo.
    upstreamURL: env.PROXY_UPSTREAM_URL ?? "https://api.openai.com/v1",
    token: env.PROXY_TOKEN || undefined,
    maxUsdPerRun: num(env.PROXY_MAX_USD_PER_RUN, 0.5),
    maxUsdPerAgent: num(env.PROXY_MAX_USD_PER_AGENT, 5),
    maxRequestsPerMinute: num(env.PROXY_MAX_RPM, 60),
    llmClassifier: env.PROXY_LLM_CLASSIFIER === "1",
    classifierModel: env.PROXY_CLASSIFIER_MODEL ?? "gpt-4o-mini",
    logDir: env.PROXY_LOG_DIR ?? path.join(PROJECT_ROOT, "logs"),
    pricing: env.PROXY_PRICING ? { ...DEFAULT_PRICING, ...JSON.parse(env.PROXY_PRICING) } : DEFAULT_PRICING,
  };
}

export function createDeps(config: ProxyConfig): ProxyDeps {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const inputGuards: InputGuard[] = [
    promptInjectionGuard(),
    sensitiveDataInputGuard(secretsGuardOptions()),
    sensitiveDataInputGuard(piiGuardOptions()),
  ];
  if (config.llmClassifier) {
    // El clasificador va directo a la API, no a través del proxy.
    inputGuards.push(llmInjectionClassifierGuard(new OpenAI({ apiKey, baseURL: config.upstreamURL }), config.classifierModel));
  }
  return {
    upstream: createHttpUpstream(config.upstreamURL, apiKey),
    inputGuards,
    outputGuards: [sensitiveDataOutputGuard(secretsGuardOptions()), jsonSchemaOutputGuard()],
    budget: new BudgetTracker({ maxUsdPerRun: config.maxUsdPerRun, maxUsdPerAgent: config.maxUsdPerAgent }),
    rateLimiter: new RateLimiter(config.maxRequestsPerMinute),
    logger: new JsonlLogger(config.logDir),
    pricing: config.pricing,
  };
}
