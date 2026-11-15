import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { handleChatCompletion, handleEmbeddings, type ProxyDeps, type ProxyResult, type Upstream } from "./proxy.js";
import type { CallContext } from "./types.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SAFE_ID = /^[\w.:-]{1,80}$/;

export interface ServerOptions {
  /** Si se define, los clientes deben mandar `Authorization: Bearer <token>`. */
  token?: string;
}

/** Lee x-agent-id y x-run-id; valores raros se reemplazan para que no ensucien logs ni métricas. */
export function contextFrom(headers: http.IncomingHttpHeaders): CallContext {
  const header = (name: string) => {
    const value = headers[name];
    return typeof value === "string" && SAFE_ID.test(value) ? value : undefined;
  };
  const agentId = header("x-agent-id") ?? "unknown";
  return { agentId, runId: header("x-run-id") ?? `${agentId}:default` };
}

function authorized(req: http.IncomingMessage, token?: string): boolean {
  if (!token) return true;
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Body demasiado grande."), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw Object.assign(new Error("El body no es JSON válido."), { status: 400 });
  }
}

function send(res: http.ServerResponse, { status, body, headers = {} }: ProxyResult) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Servidor HTTP compatible con la API de OpenAI. Los agentes lo usan con
 * OPENAI_BASE_URL=http://localhost:<puerto>/v1 sin cambiar su código.
 */
export function createProxyServer(deps: ProxyDeps, { token }: ServerOptions = {}): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://proxy");
      if (req.method === "GET" && url.pathname === "/health") return send(res, { status: 200, body: { ok: true } });
      if (!authorized(req, token)) {
        return send(res, { status: 401, body: { error: { message: "Token del proxy inválido.", type: "authentication_error", code: null, param: null } } });
      }
      if (req.method === "GET" && url.pathname === "/stats") return send(res, { status: 200, body: deps.budget.snapshot() });

      const routes: Record<string, typeof handleChatCompletion> = {
        "/v1/chat/completions": handleChatCompletion,
        "/v1/embeddings": handleEmbeddings,
      };
      const handler = req.method === "POST" ? routes[url.pathname] : undefined;
      if (!handler) {
        return send(res, { status: 404, body: { error: { message: `Ruta no soportada por el proxy: ${req.method} ${url.pathname}`, type: "invalid_request_error", code: null, param: null } } });
      }
      send(res, await handler(await readJson(req), contextFrom(req.headers), deps));
    } catch (error: any) {
      const status = error?.status ?? 500;
      send(res, { status, body: { error: { message: error?.message ?? "Error interno del proxy.", type: status === 500 ? "proxy_error" : "invalid_request_error", code: null, param: null } } });
    }
  });
}

/** Upstream real: reenvía a la API (con la API key del proxy, no la del cliente). */
export function createHttpUpstream(baseURL: string, apiKey: string, timeoutMs = 120_000): Upstream {
  return {
    async post(path, body) {
      const response = await fetch(`${baseURL.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { message: text.slice(0, 500), type: "upstream_error", code: null, param: null } };
      }
      return { status: response.status, body: parsed };
    },
  };
}
