/**
 * Servidor MCP remoto: transporte Streamable HTTP + OAuth 2.1, listo para deployar.
 *
 *   /.well-known/oauth-authorization-server   metadata del servidor de autorización
 *   /.well-known/oauth-protected-resource/mcp metadata del recurso (RFC 9728)
 *   /register /authorize /token /revoke       OAuth (registro dinámico, PKCE)
 *   /consent                                   pantalla de consentimiento del dueño
 *   /mcp                                       el servidor MCP (Bearer token obligatorio)
 *   /health                                    health check
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import { Bm25Index } from "03-rag-docs-assistant/bm25";
import { getMonorepoInfo, readProjectFile } from "05-mcp-advanced-server/files";
import { RateLimiter } from "07-guardrails-eval-proxy/budget";
import { MONOREPO_ROOT } from "@sandbox/agent-core";
import { OwnerConsentOAuthProvider, SCOPES, type Scope } from "./oauth.js";

export interface RemoteServerOptions {
  /** URL pública con la que los clientes llegan al servidor (ej: https://mcp.midominio.com). */
  publicUrl: URL;
  ownerPassword: string;
  rootDir?: string;
  maxRequestsPerMinute?: number;
  log?: (line: string) => void;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const denied = (scope: Scope) => ({ isError: true, ...text(`Permiso insuficiente: esta tool requiere el scope "${scope}" (${SCOPES[scope]}).`) });
const hasScope = (auth: AuthInfo | undefined, scope: Scope) => Boolean(auth?.scopes.includes(scope));

/** Scope que exige cada tool por encima del mínimo (mcp:read). */
export const TOOL_SCOPES: Record<string, Scope> = { server_stats: "mcp:admin" };

/** Fragmentos de los README del monorepo, para búsqueda léxica (sin llamar a ninguna API). */
async function loadDocChunks(root: string) {
  const files = ["README.md"];
  for (const dir of ["packages", "projects"]) {
    for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) files.push(`${dir}/${e.name}/README.md`);
  }
  const chunks: Array<{ source: string; text: string }> = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(root, f), "utf-8").catch(() => null);
    if (!content) continue;
    for (const part of content.split(/\n(?=#{1,3} )/)) if (part.trim().length > 40) chunks.push({ source: f, text: part.trim().slice(0, 1500) });
  }
  return chunks;
}

/** Un McpServer por sesión, con tools que verifican su scope. */
function buildMcpServer(root: string, stats: { sessions: () => number; requests: Map<string, number> }) {
  const server = new McpServer({ name: "monorepo-remote-mcp", version: "1.0.0" });

  server.registerTool(
    "read_project_file",
    { description: "Lee un archivo de texto del monorepo (ruta relativa a la raíz). No permite salir del repo ni leer .env, .git o node_modules.", inputSchema: { filePath: z.string() } },
    async ({ filePath }, extra) => {
      if (!hasScope(extra.authInfo, "mcp:read")) return denied("mcp:read");
      try {
        return text(await readProjectFile(root, filePath));
      } catch (e: any) {
        return { isError: true, ...text(e.message) };
      }
    },
  );

  server.registerTool(
    "search_docs",
    { description: "Busca en la documentación (README) de los proyectos del monorepo y devuelve los 3 fragmentos más relevantes.", inputSchema: { query: z.string() } },
    async ({ query }, extra) => {
      if (!hasScope(extra.authInfo, "mcp:read")) return denied("mcp:read");
      const chunks = await loadDocChunks(root);
      const scores = new Bm25Index(chunks.map((c) => c.text)).score(query);
      const top = scores.map((s, i) => ({ s, i })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
      return text(top.length ? top.map(({ i }) => `## ${chunks[i].source}\n${chunks[i].text}`).join("\n\n---\n\n") : "Sin resultados.");
    },
  );

  server.registerTool(
    "server_stats",
    { description: "Estadísticas internas del servidor (sesiones activas y requests por cliente). Requiere el scope mcp:admin.", inputSchema: {} },
    async (_args, extra) => {
      if (!hasScope(extra.authInfo, "mcp:admin")) return denied("mcp:admin");
      return text(JSON.stringify({ activeSessions: stats.sessions(), requestsByClient: Object.fromEntries(stats.requests) }, null, 2));
    },
  );

  server.registerResource("monorepo-info", "config://monorepo-info", { description: "Proyectos y paquetes del monorepo", mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await getMonorepoInfo(root), null, 2) }],
  }));
  return server;
}

export function createRemoteMcpApp({ publicUrl, ownerPassword, rootDir = MONOREPO_ROOT, maxRequestsPerMinute = 120, log = () => {} }: RemoteServerOptions) {
  const mcpUrl = new URL("/mcp", publicUrl);
  const provider = new OwnerConsentOAuthProvider({ ownerPassword, resource: mcpUrl });
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const requests = new Map<string, number>();
  const limiter = new RateLimiter(maxRequestsPerMinute);

  const app = express();
  app.set("trust proxy", 1);
  app.get("/health", (_req, res) => void res.json({ ok: true, sessions: sessions.size }));
  app.use(mcpAuthRouter({ provider, issuerUrl: publicUrl, resourceServerUrl: mcpUrl, scopesSupported: Object.keys(SCOPES), resourceName: "Monorepo agentic-engineering-sandbox" }));
  app.post("/consent", express.urlencoded({ extended: false }), (req, res) => void provider.handleConsent(req, res).catch((e) => res.status(500).send(String(e?.message ?? e))));

  const auth = requireBearerAuth({ verifier: provider, requiredScopes: ["mcp:read"], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });

  app.all("/mcp", auth, express.json({ limit: "1mb" }), async (req, res) => {
    const clientId = req.auth?.clientId ?? "?";
    const wait = limiter.tryAcquire(clientId);
    if (wait > 0) {
      res.setHeader("retry-after", String(wait));
      return void res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: `Rate limit: reintentá en ${wait}s` }, id: null });
    }
    requests.set(clientId, (requests.get(clientId) ?? 0) + 1);

    // Step-up (spec de autorización de MCP): si la tool pide un scope que el token no tiene,
    // 403 insufficient_scope con el scope necesario; el cliente vuelve a pedir consentimiento.
    const toolScope = req.body?.method === "tools/call" ? TOOL_SCOPES[req.body?.params?.name] : undefined;
    if (toolScope && !hasScope(req.auth, toolScope)) {
      const needed = [...new Set([...(req.auth?.scopes ?? []), toolScope])].join(" ");
      res.setHeader("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${needed}", resource_metadata="${getOAuthProtectedResourceMetadataUrl(mcpUrl)}"`);
      return void res.status(403).json({ jsonrpc: "2.0", error: { code: -32001, message: `Hace falta el scope ${toolScope}` }, id: req.body?.id ?? null });
    }
    log(`${new Date().toISOString()} ${req.method} /mcp client=${clientId} session=${req.headers["mcp-session-id"] ?? "-"} method=${req.body?.method ?? "-"}`);

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      if (req.method !== "POST" || req.body?.method !== "initialize") {
        return void res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Sesión inexistente: empezá con initialize." }, id: null });
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => void sessions.set(id, transport!),
      });
      transport.onclose = () => transport!.sessionId && sessions.delete(transport!.sessionId);
      await buildMcpServer(rootDir, { sessions: () => sessions.size, requests }).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  return { app, provider, mcpUrl };
}
