/**
 * Cliente MCP remoto con OAuth: usa el cliente oficial del SDK, que hace el flujo
 * completo (descubrimiento por metadata → registro dinámico → /authorize con PKCE →
 * /token). Este archivo solo provee dónde guardar las credenciales y cómo obtener el
 * "code" del consentimiento.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** Recibe la URL de autorización y devuelve el code (o lanza si el usuario rechaza). */
export type Approver = (authorizationUrl: URL) => Promise<string>;

export class MemoryOAuthClientProvider implements OAuthClientProvider {
  private info?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private verifier = "";
  pendingCode: Promise<string> | null = null;

  constructor(private options: { clientName: string; scope: string; redirectUrl: string; approve: Approver }) {}

  get redirectUrl() {
    return this.options.redirectUrl;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.options.clientName,
      redirect_uris: [this.options.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Cliente público (sin secreto): por eso PKCE es obligatorio.
      token_endpoint_auth_method: "none",
      scope: this.options.scope,
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  redirectToAuthorization(url: URL) {
    this.pendingCode = this.options.approve(url);
  }
  /** Descarta el refresh token: obliga a la próxima autorización a pasar por el consentimiento. */
  dropRefreshToken() {
    if (this.savedTokens) this.savedTokens = { ...this.savedTokens, refresh_token: undefined };
  }
}

/**
 * "Aprobador" programático: abre la pantalla de consentimiento, la aprueba con la
 * contraseña del dueño y lee el code de la redirección. Sirve para tests y scripts;
 * una app real abre la URL en el navegador y recibe el code en su redirect_uri.
 */
export function passwordApprover(password: string, decision: "approve" | "deny" = "approve"): Approver {
  return async (authorizationUrl) => {
    const page = await fetch(authorizationUrl, { redirect: "manual" });
    const html = await page.text();
    const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1];
    if (!requestId) throw new Error(`La pantalla de consentimiento no tiene request_id (HTTP ${page.status}): ${html.slice(0, 200)}`);
    const consent = await fetch(new URL("/consent", authorizationUrl), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request_id: requestId, decision, password }),
    });
    const location = consent.headers.get("location");
    if (!location) throw new Error(`Consentimiento rechazado (HTTP ${consent.status}).`);
    const redirect = new URL(location);
    const code = redirect.searchParams.get("code");
    if (!code) throw new Error(`Sin code: ${redirect.searchParams.get("error") ?? "respuesta inesperada"}`);
    return code;
  };
}

export interface RemoteConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  /**
   * Ejecuta una operación y, si el servidor pide más permisos (step-up: 403 insufficient_scope),
   * pide un nuevo consentimiento con `scope` y la reintenta.
   */
  withStepUp<T>(fn: (client: Client) => Promise<T>, scope?: string): Promise<T>;
}

/** Conecta un cliente MCP a un servidor remoto, haciendo el flujo OAuth si hace falta. */
export async function connectRemote(mcpUrl: URL, provider: MemoryOAuthClientProvider, name = "monorepo-remote-client"): Promise<RemoteConnection> {
  let client = new Client({ name, version: "1.0.0" });
  let transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  try {
    await client.connect(transport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError) || !provider.pendingCode) throw error;
    // El servidor respondió 401 → el SDK descubrió el servidor de autorización, registró
    // al cliente y pidió la autorización. Con el code, se cambian tokens y se reconecta.
    await transport.finishAuth(await provider.pendingCode);
    provider.pendingCode = null;
    client = new Client({ name, version: "1.0.0" });
    transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
    await client.connect(transport);
  }
  const connection: RemoteConnection = {
    client,
    transport,
    async withStepUp(fn, scope = "mcp:read mcp:admin") {
      try {
        return await fn(connection.client);
      } catch (error: any) {
        if (!/403/.test(String(error?.message))) throw error;
        // El SDK intenta el step-up con el refresh token, pero un refresh no puede ampliar
        // scopes (RFC 6749 §6) y vuelve el mismo token: termina en "403 after trying upscoping".
        // Hace falta una autorización nueva, con consentimiento, para el scope ampliado.
        provider.dropRefreshToken();
        const result = await auth(provider, { serverUrl: mcpUrl, scope });
        if (result === "REDIRECT") {
          if (!provider.pendingCode) throw error;
          await connection.transport.finishAuth(await provider.pendingCode);
          provider.pendingCode = null;
        }
        return fn(connection.client);
      }
    },
  };
  return connection;
}
