import { BudgetTracker, RateLimiter, costOf, type ModelPrice } from "./budget.js";
import type { InputGuard, OutputGuard } from "./guards/index.js";
import { SECRET_DETECTORS, PII_DETECTORS, scan } from "./guards/redactors.js";
import type { LogEntry, Logger } from "./logger.js";
import type { CallContext, ChatRequest, ChatResponse, EmbeddingsRequest, Finding } from "./types.js";

export interface UpstreamResponse {
  status: number;
  body: any;
}

/** El LLM real (o uno falso en los tests). */
export interface Upstream {
  post(path: "/chat/completions" | "/embeddings", body: unknown): Promise<UpstreamResponse>;
}

export interface ProxyDeps {
  upstream: Upstream;
  inputGuards: InputGuard[];
  outputGuards: OutputGuard[];
  budget: BudgetTracker;
  rateLimiter: RateLimiter;
  logger: Logger;
  pricing: Record<string, ModelPrice>;
}

export interface ProxyResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type ErrorType = "guardrail_violation" | "budget_exceeded" | "rate_limited" | "invalid_request_error";

/** Error con el mismo formato que la API de OpenAI, así el SDK de los agentes lo entiende. */
function apiError(status: number, type: ErrorType, message: string, findings: Finding[] = [], headers?: Record<string, string>): ProxyResult {
  return { status, headers, body: { error: { message, type, code: type, param: null, findings } } };
}

const summarize = (findings: Finding[]) => findings.map((f) => `${f.guard}: ${f.message} en ${f.location}`).join("; ");

/**
 * Controles comunes a todos los endpoints, antes de gastar un token:
 * rate limit (429, el SDK reintenta solo) y presupuesto (402, no reintenta).
 */
function preflight(ctx: CallContext, deps: ProxyDeps): ProxyResult | null {
  const wait = deps.rateLimiter.tryAcquire(ctx.agentId);
  if (wait > 0) {
    return apiError(429, "rate_limited", `Rate limit del proxy para "${ctx.agentId}". Reintentá en ${wait}s.`, [], { "retry-after": String(wait) });
  }
  const budget = deps.budget.check(ctx);
  if (!budget.allowed) return apiError(402, "budget_exceeded", `Presupuesto agotado: ${budget.reason}`);
  return null;
}

const OUTCOME_BY_STATUS: Record<number, LogEntry["outcome"]> = { 402: "budget_exceeded", 429: "rate_limited" };

export async function handleChatCompletion(body: unknown, ctx: CallContext, deps: ProxyDeps): Promise<ProxyResult> {
  const started = Date.now();
  const findings: Finding[] = [];
  let request = body as ChatRequest;
  const log = (entry: Partial<LogEntry> & Pick<LogEntry, "outcome" | "status">) =>
    deps.logger.write({
      ts: new Date().toISOString(),
      agentId: ctx.agentId,
      runId: ctx.runId,
      endpoint: "chat.completions",
      model: typeof request?.model === "string" ? request.model : "?",
      latencyMs: Date.now() - started,
      findings,
      messages: Array.isArray(request?.messages) ? request.messages.length : undefined,
      ...entry,
    });

  if (!request || typeof request.model !== "string" || !Array.isArray(request.messages)) {
    await log({ outcome: "bad_request", status: 400 });
    return apiError(400, "invalid_request_error", "El body debe tener model y messages.");
  }
  if (request.stream) {
    await log({ outcome: "bad_request", status: 400 });
    return apiError(400, "invalid_request_error", "El proxy no soporta stream: true (no podría validar la salida antes de devolverla).");
  }

  const rejected = preflight(ctx, deps);
  if (rejected) {
    await log({ outcome: OUTCOME_BY_STATUS[rejected.status], status: rejected.status });
    return rejected;
  }

  // 1. Guardrails de entrada: cada uno puede tachar contenido o pedir bloquear.
  for (const guard of deps.inputGuards) {
    const result = await guard.checkInput(request, ctx);
    findings.push(...result.findings);
    if (result.request) request = result.request;
  }
  const inputBlocks = findings.filter((f) => f.action === "block");
  if (inputBlocks.length > 0) {
    await log({ outcome: "blocked", status: 400 });
    return apiError(400, "guardrail_violation", `Request bloqueado por guardrails: ${summarize(inputBlocks)}`, inputBlocks);
  }

  // 2. Llamada al LLM real.
  const upstream = await deps.upstream.post("/chat/completions", request);
  if (upstream.status !== 200) {
    await log({ outcome: "upstream_error", status: upstream.status });
    return { status: upstream.status, body: upstream.body };
  }
  let response = upstream.body as ChatResponse;
  const costUsd = costOf(request.model, response.usage, deps.pricing);
  deps.budget.record(ctx, costUsd);

  // 3. Guardrails de salida.
  for (const guard of deps.outputGuards) {
    const result = await guard.checkOutput(response, request, ctx);
    findings.push(...result.findings);
    if (result.response) response = result.response;
  }
  const outputBlocks = findings.filter((f) => f.action === "block");
  if (outputBlocks.length > 0) {
    await log({ outcome: "blocked", status: 422, usage: response.usage, costUsd });
    // 422 y no 5xx: el SDK reintenta los 5xx automáticamente y volvería a gastar.
    return apiError(422, "guardrail_violation", `Respuesta bloqueada por guardrails: ${summarize(outputBlocks)}`, outputBlocks);
  }

  await log({ outcome: "allowed", status: 200, usage: response.usage, costUsd });
  return { status: 200, body: response, headers: proxyHeaders(costUsd, findings) };
}

/**
 * Embeddings: no hay salida de texto que validar, pero sí entrada (lo que se
 * indexa puede tener secretos) y costo.
 */
export async function handleEmbeddings(body: unknown, ctx: CallContext, deps: ProxyDeps): Promise<ProxyResult> {
  const started = Date.now();
  const findings: Finding[] = [];
  const request = body as EmbeddingsRequest;
  const log = (entry: Partial<LogEntry> & Pick<LogEntry, "outcome" | "status">) =>
    deps.logger.write({
      ts: new Date().toISOString(),
      agentId: ctx.agentId,
      runId: ctx.runId,
      endpoint: "embeddings",
      model: typeof request?.model === "string" ? request.model : "?",
      latencyMs: Date.now() - started,
      findings,
      ...entry,
    });

  if (!request || typeof request.model !== "string" || request.input === undefined) {
    await log({ outcome: "bad_request", status: 400 });
    return apiError(400, "invalid_request_error", "El body debe tener model e input.");
  }
  const rejected = preflight(ctx, deps);
  if (rejected) {
    await log({ outcome: OUTCOME_BY_STATUS[rejected.status], status: rejected.status });
    return rejected;
  }

  const redactText = (text: string, location: string) => {
    const { text: out, counts } = scan(text, [...SECRET_DETECTORS, ...PII_DETECTORS.filter((d) => d.type !== "email")], () => true);
    for (const [type, count] of Object.entries(counts)) findings.push({ guard: "secrets", action: "redact", message: `${count} × ${type}`, location });
    return out;
  };
  const input = typeof request.input === "string"
    ? redactText(request.input, "input")
    : Array.isArray(request.input) && request.input.every((x) => typeof x === "string")
      ? (request.input as string[]).map((t, i) => redactText(t, `input[${i}]`))
      : request.input;

  const upstream = await deps.upstream.post("/embeddings", { ...request, input });
  if (upstream.status !== 200) {
    await log({ outcome: "upstream_error", status: upstream.status });
    return { status: upstream.status, body: upstream.body };
  }
  const costUsd = costOf(request.model, upstream.body?.usage, deps.pricing);
  deps.budget.record(ctx, costUsd);
  await log({ outcome: "allowed", status: 200, usage: upstream.body?.usage, costUsd });
  return { status: 200, body: upstream.body, headers: proxyHeaders(costUsd, findings) };
}

function proxyHeaders(costUsd: number, findings: Finding[]): Record<string, string> {
  return { "x-proxy-cost-usd": costUsd.toFixed(6), "x-proxy-findings": String(findings.length) };
}
