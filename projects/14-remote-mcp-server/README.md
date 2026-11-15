# 🌐 Proyecto 14: Remote MCP Server

El servidor MCP del [proyecto 05](../05-mcp-advanced-server) llevado **a producción**: transporte **Streamable HTTP**, autorización **OAuth 2.1** como pide la especificación de MCP, scopes por tool, rate limiting, health check e imagen Docker. Lo pueden usar clientes reales (Claude Code, IDEs, otros agentes) por la red.

```text
cliente MCP ──POST /mcp (sin token)──▶ 401 + WWW-Authenticate: resource_metadata=…
   │  descubre /.well-known/oauth-protected-resource/mcp y /.well-known/oauth-authorization-server
   │  POST /register (registro dinámico, cliente público)
   │  GET /authorize (PKCE S256) ──▶ 🔐 pantalla de consentimiento: el dueño aprueba con su contraseña
   │  POST /token ──▶ access token (1 h) + refresh token (30 d, con rotación)
   └─ POST /mcp con Bearer ──▶ tools según los scopes del token
```

---

## 🔐 Seguridad

| Medida | Detalle |
|---|---|
| **OAuth 2.1 con las piezas del SDK de MCP** | `mcpAuthRouter` (metadata, registro dinámico, `/authorize`, `/token` con PKCE, revocación) y `requireBearerAuth`. El provider (`src/oauth.ts`) es propio: el ejemplo del SDK aprueba todo sin preguntar. |
| **Consentimiento real** | `/authorize` muestra qué cliente pide qué permisos, y solo se aprueba con la contraseña del dueño (`MCP_OWNER_PASSWORD`, comparación en tiempo constante). |
| **Tokens** | Se guardan **hasheados** (SHA-256). El code es de un solo uso y vence a los 5 minutos. El access token dura 1 hora; el refresh token, 30 días con **rotación** (el viejo deja de servir) y sin poder ampliar scopes. |
| **Audiencia** | El token queda atado a este recurso (RFC 8707): uno emitido para otro servidor se rechaza. |
| **Scopes por tool** | `mcp:read` (leer archivos, buscar en la documentación) y `mcp:admin` (estadísticas internas). Si una tool pide más de lo que tiene el token, el servidor responde **403 `insufficient_scope`** con el scope necesario (*step-up*), y el cliente vuelve a pedir consentimiento. El chequeo dentro de la tool queda como segunda línea de defensa. |
| **Guardrails heredados** | `read_project_file` usa el sandbox del 05: nada fuera del repo, ni `.env`, `.git` o `node_modules`. |
| **Operación** | Rate limit por cliente (429 + `Retry-After`), body máximo de 1 MB, `/health`, log por request (cliente, sesión, método). Fuera de localhost exige `https` y una contraseña de 12+ caracteres. |

---

## ▶️ Uso

```bash
MCP_OWNER_PASSWORD="una-contraseña-larga" npm start -w 14-remote-mcp-server        # http://localhost:3333/mcp

# Un agente del monorepo usando las tools remotas (OAuth + loadMcpTools de agent-core)
MCP_OWNER_PASSWORD="una-contraseña-larga" npm run agent -w 14-remote-mcp-server -- "¿qué proyectos usan MCP?"

# Claude Code: hace el descubrimiento, el registro y abre el navegador en la pantalla de consentimiento
claude mcp add --transport http monorepo http://localhost:3333/mcp
```

### Deploy

```bash
docker build -f projects/14-remote-mcp-server/Dockerfile -t monorepo-mcp .     # desde la raíz del monorepo
docker run -p 3333:3333 -e MCP_PUBLIC_URL=https://mcp.tudominio.com -e MCP_OWNER_PASSWORD=... monorepo-mcp
```

La imagen corre en cualquier plataforma de contenedores (Fly.io, Railway, Cloud Run, Render). Variables: `MCP_PUBLIC_URL` (la URL **https** pública: se usa como issuer de OAuth y como audiencia de los tokens), `MCP_OWNER_PASSWORD` (como secreto de la plataforma) y `PORT`. El `.dockerignore` deja afuera `.env`, `.git` y los datos generados.

> **No probado:** la imagen Docker (Docker no estaba corriendo) y la conexión desde Claude Code (requiere interacción en el navegador). El deploy necesita una cuenta en la plataforma, que tenés que crear vos.

**Antes de producción:** los clientes, codes y tokens viven en memoria (un reinicio obliga a reautorizar). Para varias instancias hacen falta un store compartido (Redis o Postgres) y sesiones MCP persistentes o sticky.

---

## 🔬 Resultados

- **Agente real (GPT-4o, por el proxy del 07):** se autenticó por OAuth (`scope: mcp:read`), descubrió las 3 tools remotas con `loadMcpTools` y respondió usando `search_docs` sobre HTTP.
- **Tests con el cliente oficial del SDK contra el servidor real** (`src/remote.test.ts`, 8 tests): metadata OAuth y 401 con `resource_metadata`; flujo completo (registro, consentimiento, PKCE, tokens, tools); `.env` bloqueado; **step-up** aprobado y rechazado; contraseña incorrecta y rechazo del dueño; scopes inexistentes (`invalid_scope`); refresh con rotación; rate limit.

**Lo que apareció en el camino:**
- **El scope lo decide el servidor.** El SDK elige el scope del desafío `WWW-Authenticate`, luego el de los `scopes_supported` y recién al final el que pidió el cliente. Por eso los permisos mayores se piden con *step-up* (403 `insufficient_scope`), como dice la especificación.
- **El step-up del SDK entraba en loop.** Ante el 403, el SDK usa el refresh token, pero un refresh no puede ampliar scopes (RFC 6749 §6) y devuelve el mismo token, hasta que el SDK corta con "403 after trying upscoping". El cliente (`src/oauthClient.ts`) descarta el refresh token y fuerza una **autorización nueva con consentimiento**.
- **Los tests colgaban al cerrar el servidor**, porque el cliente MCP deja un stream SSE abierto. Se resolvió con `closeAllConnections()`.

---

## 📂 Estructura

```text
14-remote-mcp-server/
├── src/
│   ├── oauth.ts          # Provider OAuth: consentimiento, tokens hasheados, refresh con rotación, audiencia
│   ├── server.ts         # Express: rutas OAuth, /consent, /mcp (Streamable HTTP + Bearer + step-up + rate limit)
│   ├── oauthClient.ts    # Cliente: OAuthClientProvider, aprobador por contraseña, step-up
│   ├── agentClient.ts    # Agente de agent-core usando las tools remotas
│   ├── index.ts          # Arranque con validaciones (https, contraseña)
│   └── remote.test.ts    # Flujo completo con el cliente oficial
└── Dockerfile            # Imagen (se construye desde la raíz)
```
