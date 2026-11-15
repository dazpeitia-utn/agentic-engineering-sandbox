/**
 * Flujo completo con el cliente oficial de MCP contra el servidor real (HTTP):
 * descubrimiento OAuth, registro dinámico, consentimiento, PKCE, tokens y tools con scopes.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryOAuthClientProvider, connectRemote, passwordApprover } from "./oauthClient.js";
import { createRemoteMcpApp } from "./server.js";

const PASSWORD = "clave-del-dueño";
const servers: Server[] = [];
afterEach(async () => {
  // closeAllConnections: los clientes MCP dejan abierto un stream SSE que impediría cerrar.
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
});

async function start(options: { maxRequestsPerMinute?: number } = {}) {
  // Primero se reserva un puerto libre para conocer la URL pública, después se arma la app con esa URL.
  const probe = await new Promise<Server>((r) => { const s = (require("node:http") as typeof import("node:http")).createServer(); s.listen(0, "127.0.0.1", () => r(s)); });
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const publicUrl = new URL(`http://127.0.0.1:${port}`);
  const { app, mcpUrl } = createRemoteMcpApp({ publicUrl, ownerPassword: PASSWORD, ...options });
  servers.push(await new Promise<Server>((r) => { const s = app.listen(port, "127.0.0.1", () => r(s)); }));
  return { publicUrl, mcpUrl };
}

const provider = (scope: string, approve = passwordApprover(PASSWORD)) =>
  new MemoryOAuthClientProvider({ clientName: "test-client", scope, redirectUrl: "http://127.0.0.1:9/callback", approve });

const textOf = (r: any) => r.content?.map((c: any) => c.text).join("\n") ?? "";

describe("MCP remoto con OAuth", () => {
  it("publica la metadata de OAuth y del recurso protegido, y sin token responde 401 indicando dónde autenticarse", async () => {
    const { publicUrl, mcpUrl } = await start();
    const as = await (await fetch(new URL("/.well-known/oauth-authorization-server", publicUrl))).json();
    expect(as).toMatchObject({ issuer: expect.stringContaining("127.0.0.1"), code_challenge_methods_supported: ["S256"], scopes_supported: ["mcp:read", "mcp:admin"] });
    expect(as.registration_endpoint).toBeTruthy();

    const res = await fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("flujo completo: el cliente oficial se registra, el dueño aprueba y usa las tools", async () => {
    const { mcpUrl } = await start();
    const p = provider("mcp:read");
    const { client } = await connectRemote(mcpUrl, p);
    expect(p.tokens()?.access_token).toBeTruthy();
    expect(p.tokens()?.refresh_token).toBeTruthy();

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["read_project_file", "search_docs", "server_stats"]);
    expect(textOf(await client.callTool({ name: "read_project_file", arguments: { filePath: "package.json" } }))).toContain("agentic-engineering-sandbox");
    expect(textOf(await client.callTool({ name: "search_docs", arguments: { query: "guardrails prompt injection proxy" } }))).toContain("07-guardrails-eval-proxy");

    // Los guardrails del 05 siguen vigentes: .env no se puede leer.
    const env: any = await client.callTool({ name: "read_project_file", arguments: { filePath: ".env" } });
    expect(env.isError).toBe(true);
    await client.close();
  });

  it("step-up: una tool con más permisos dispara un nuevo consentimiento y después funciona", async () => {
    const { mcpUrl } = await start();
    const p = provider("mcp:read");
    const conn = await connectRemote(mcpUrl, p);
    expect(p.tokens()?.scope).toBe("mcp:read");
    const stats = await conn.withStepUp((c) => c.callTool({ name: "server_stats", arguments: {} }));
    expect(JSON.parse(textOf(stats))).toMatchObject({ activeSessions: 1 });
    expect(p.tokens()?.scope).toBe("mcp:read mcp:admin");
  });

  it("si el dueño no aprueba el step-up, la tool sigue bloqueada", async () => {
    const { mcpUrl } = await start();
    let approvals = 0;
    const p = provider("mcp:read", async (url) => (approvals++ === 0 ? passwordApprover(PASSWORD)(url) : passwordApprover(PASSWORD, "deny")(url)));
    const conn = await connectRemote(mcpUrl, p);
    await expect(conn.withStepUp((c) => c.callTool({ name: "server_stats", arguments: {} }))).rejects.toThrow(/access_denied/);
  });

  it("sin la contraseña del dueño, o si rechaza, no hay token", async () => {
    const { mcpUrl } = await start();
    await expect(connectRemote(mcpUrl, provider("mcp:read", passwordApprover("otra")))).rejects.toThrow(/rechazado|401/i);
    await expect(connectRemote(mcpUrl, provider("mcp:read", passwordApprover(PASSWORD, "deny")))).rejects.toThrow(/access_denied/);
  });

  it("/authorize no acepta scopes que no existen", async () => {
    const { publicUrl } = await start();
    const reg = await (await fetch(new URL("/register", publicUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "x", redirect_uris: ["http://127.0.0.1:9/cb"], token_endpoint_auth_method: "none" }) })).json();
    const url = new URL("/authorize", publicUrl);
    for (const [k, v] of Object.entries({ client_id: reg.client_id, redirect_uri: "http://127.0.0.1:9/cb", response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "S256", scope: "mcp:read mcp:root" })) url.searchParams.set(k, v);
    const res = await fetch(url, { redirect: "manual" });
    expect(res.headers.get("location") ?? "").toContain("error=invalid_scope");
  });

  it("refresh token con rotación: el viejo deja de servir", async () => {
    const { publicUrl, mcpUrl } = await start();
    const p = provider("mcp:read");
    await connectRemote(mcpUrl, p);
    const clientId = (p.clientInformation() as any).client_id;
    const refresh = (old: string) =>
      fetch(new URL("/token", publicUrl), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: old, client_id: clientId }) });
    const first = await refresh(p.tokens()!.refresh_token!);
    expect(first.status).toBe(200);
    expect((await first.json()).access_token).toBeTruthy();
    expect((await refresh(p.tokens()!.refresh_token!)).status).toBe(400);
  });

  it("aplica rate limit por cliente", async () => {
    const { mcpUrl } = await start({ maxRequestsPerMinute: 4 });
    const { client } = await connectRemote(mcpUrl, provider("mcp:read"));
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => client.callTool({ name: "search_docs", arguments: { query: "mcp" } })));
    expect(results.some((r) => r.status === "rejected")).toBe(true);
  });
});
