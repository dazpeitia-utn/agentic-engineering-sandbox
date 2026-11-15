/**
 * Servidor de autorización OAuth 2.1 para el MCP remoto, sobre las piezas del SDK de
 * MCP (mcpAuthRouter: metadata, registro dinámico de clientes, /authorize, /token con
 * PKCE, revocación). A diferencia del ejemplo del SDK, que aprueba todo sin preguntar:
 *  - /authorize muestra una pantalla de consentimiento y exige la contraseña del dueño;
 *  - los tokens se guardan hasheados (SHA-256), con vencimiento;
 *  - hay refresh tokens con rotación;
 *  - el token queda atado al recurso (RFC 8707) y a los scopes pedidos y soportados.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError, InvalidRequestError, InvalidScopeError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export const SCOPES = {
  "mcp:read": "Leer archivos y documentación del monorepo",
  "mcp:admin": "Ver estadísticas internas del servidor",
} as const;
export type Scope = keyof typeof SCOPES;

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;
const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();
  async getClient(id: string) {
    return this.clients.get(id);
  }
  async registerClient(client: OAuthClientInformationFull) {
    this.clients.set(client.client_id, client);
    return client;
  }
}

interface Grant {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

export class OwnerConsentOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private pending = new Map<string, { client: OAuthClientInformationFull; params: AuthorizationParams; expiresAt: number }>();
  private codes = new Map<string, Grant & { challenge: string; redirectUri: string }>();
  private accessTokens = new Map<string, Grant>();
  private refreshTokens = new Map<string, Grant>();

  constructor(private options: { ownerPassword: string; resource: URL; now?: () => number }) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private grantScopes(requested: string[] | undefined): string[] {
    const scopes = requested?.length ? requested : ["mcp:read"];
    const unknown = scopes.filter((s) => !(s in SCOPES));
    if (unknown.length) throw new InvalidScopeError(`Scopes no soportados: ${unknown.join(", ")}`);
    return scopes;
  }

  private checkResource(resource?: URL | string) {
    // RFC 8707: el token solo sirve para ESTE servidor MCP (evita que otro servicio lo reutilice).
    if (resource && resource.toString() !== this.options.resource.toString()) {
      throw new InvalidRequestError(`El recurso pedido (${resource}) no es este servidor (${this.options.resource}).`);
    }
  }

  /** Paso 1 del flujo: en vez de aprobar, muestra la pantalla de consentimiento. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) throw new InvalidRequestError("redirect_uri no registrado");
    this.checkResource(params.resource);
    const scopes = this.grantScopes(params.scopes);
    const requestId = newSecret();
    this.pending.set(requestId, { client, params: { ...params, scopes }, expiresAt: this.now() + PENDING_TTL_MS });
    res.status(200).type("html").send(consentPage(requestId, client.client_name ?? client.client_id, scopes));
  }

  /** Paso 2: el dueño aprueba (con su contraseña) o rechaza. Se redirige al cliente con el code o con access_denied. */
  async handleConsent(req: Request, res: Response): Promise<void> {
    const { request_id, decision, password } = req.body ?? {};
    const pending = typeof request_id === "string" ? this.pending.get(request_id) : undefined;
    if (!pending || pending.expiresAt < this.now()) {
      res.status(400).type("text").send("Solicitud de autorización inexistente o vencida.");
      return;
    }
    const { client, params } = pending;
    const redirect = new URL(params.redirectUri);
    if (params.state) redirect.searchParams.set("state", params.state);

    if (decision !== "approve") {
      this.pending.delete(request_id);
      redirect.searchParams.set("error", "access_denied");
      res.redirect(302, redirect.toString());
      return;
    }
    const given = Buffer.from(sha256(String(password ?? "")));
    if (!timingSafeEqual(given, Buffer.from(sha256(this.options.ownerPassword)))) {
      // No se borra la solicitud: puede reintentar con la contraseña correcta.
      res.status(401).type("html").send(consentPage(request_id, client.client_name ?? client.client_id, params.scopes ?? [], "Contraseña incorrecta."));
      return;
    }
    this.pending.delete(request_id);
    const code = newSecret();
    this.codes.set(sha256(code), {
      clientId: client.client_id,
      scopes: params.scopes ?? [],
      resource: params.resource?.toString(),
      challenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      expiresAt: this.now() + CODE_TTL_MS,
    });
    redirect.searchParams.set("code", code);
    res.redirect(302, redirect.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string): Promise<string> {
    const grant = this.codes.get(sha256(code));
    if (!grant) throw new InvalidGrantError("Código de autorización inválido");
    return grant.challenge;
  }

  private issue(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const access = newSecret();
    const refresh = newSecret();
    this.accessTokens.set(sha256(access), { clientId, scopes, resource, expiresAt: this.now() + ACCESS_TTL_S * 1000 });
    this.refreshTokens.set(sha256(refresh), { clientId, scopes, resource, expiresAt: this.now() + REFRESH_TTL_S * 1000 });
    return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(" ") };
  }

  /** Paso 3: el code (de un solo uso, 5 minutos) se cambia por tokens. El SDK ya verificó PKCE. */
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const key = sha256(code);
    const grant = this.codes.get(key);
    this.codes.delete(key);
    if (!grant || grant.expiresAt < this.now()) throw new InvalidGrantError("Código inválido o vencido");
    if (grant.clientId !== client.client_id) throw new InvalidGrantError("El código no fue emitido para este cliente");
    if (redirectUri && redirectUri !== grant.redirectUri) throw new InvalidGrantError("redirect_uri distinto al de la autorización");
    this.checkResource(resource ?? grant.resource);
    return this.issue(client.client_id, grant.scopes, grant.resource);
  }

  /** Refresh con rotación: el refresh token viejo deja de servir. Se pueden pedir menos scopes, nunca más. */
  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const key = sha256(refreshToken);
    const grant = this.refreshTokens.get(key);
    this.refreshTokens.delete(key);
    if (!grant || grant.expiresAt < this.now() || grant.clientId !== client.client_id) throw new InvalidGrantError("Refresh token inválido");
    this.checkResource(resource ?? grant.resource);
    const narrowed = scopes?.length ? scopes : grant.scopes;
    if (narrowed.some((s) => !grant.scopes.includes(s))) throw new InvalidScopeError("No se pueden ampliar los scopes con un refresh");
    return this.issue(client.client_id, narrowed, grant.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = this.accessTokens.get(sha256(token));
    if (!grant || grant.expiresAt < this.now()) throw new InvalidGrantError("Token inválido o vencido");
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(grant.expiresAt / 1000), resource: grant.resource ? new URL(grant.resource) : undefined };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const key = sha256(request.token);
    this.accessTokens.delete(key);
    this.refreshTokens.delete(key);
  }
}

function consentPage(requestId: string, clientName: string, scopes: string[], error?: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar acceso</title>
<style>:root{--bg:#f6f6f4;--card:#fff;--text:#1b1b1a;--muted:#666;--line:#ddd;--accent:#2f5fd0}@media (prefers-color-scheme:dark){:root{--bg:#151514;--card:#1f1f1d;--text:#eee;--muted:#999;--line:#333}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:24px;max-width:420px;width:100%}h1{font-size:19px;margin:0 0 8px}ul{padding-left:20px}
input{width:100%;padding:8px;margin:6px 0 14px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);box-sizing:border-box}
.row{display:flex;gap:8px}button{flex:1;padding:9px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--text);cursor:pointer}button[value=approve]{background:var(--accent);color:#fff;border-color:var(--accent)}.err{color:#d33}</style></head>
<body><form method="post" action="/consent"><h1>¿Autorizar a ${esc(clientName)}?</h1>
<p>Pide acceso al servidor MCP del monorepo con estos permisos:</p><ul>${scopes.map((s) => `<li><b>${esc(s)}</b>: ${esc(SCOPES[s as Scope] ?? s)}</li>`).join("")}</ul>
${error ? `<p class="err">${esc(error)}</p>` : ""}<label>Contraseña del dueño del servidor<input type="password" name="password" autocomplete="current-password" required></label>
<input type="hidden" name="request_id" value="${esc(requestId)}"><div class="row"><button name="decision" value="deny" formnovalidate>Rechazar</button><button name="decision" value="approve">Autorizar</button></div></form></body></html>`;
}
