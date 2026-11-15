/**
 * Un agente del monorepo usando el MCP REMOTO: se autentica por OAuth, descubre las
 * tools del servidor y las usa con el loop de agent-core (como el 02 hacía por stdio).
 *
 *   MCP_OWNER_PASSWORD=... npm run agent -w 14-remote-mcp-server -- "¿qué proyectos usan MCP y cómo?"
 *
 * La aprobación usa la contraseña del dueño de forma programática (es una demo
 * local). Una app real abre la URL de autorización en el navegador.
 */
import { createLLM, consoleLogger, loadMcpTools, runAgent } from "@sandbox/agent-core";
import { MemoryOAuthClientProvider, connectRemote, passwordApprover } from "./oauthClient.js";

const mcpUrl = new URL(process.env.MCP_URL ?? "http://localhost:3333/mcp");
const question = process.argv.slice(2).join(" ") || "¿Qué proyectos de este monorepo usan MCP y para qué? Respondé citando los archivos que leíste.";

const provider = new MemoryOAuthClientProvider({
  clientName: "agente-del-monorepo",
  scope: "mcp:read",
  redirectUrl: "http://127.0.0.1:8976/callback",
  approve: passwordApprover(process.env.MCP_OWNER_PASSWORD ?? ""),
});

const { client } = await connectRemote(mcpUrl, provider, "agente-del-monorepo");
const tools = await loadMcpTools(client);
console.log(`🔐 Autenticado por OAuth (scope: ${provider.tokens()?.scope}) · tools remotas: ${tools.map((t) => t.name).join(", ")}\n`);

const llm = await createLLM();
const result = await runAgent({
  name: "remote-mcp-agent",
  client: llm.client,
  model: llm.model,
  system: "Respondés preguntas sobre un monorepo usando SOLO las tools remotas (search_docs, read_project_file). Citá los archivos que usaste.",
  user: question,
  tools,
  maxIterations: 8,
  onEvent: consoleLogger("🌐"),
});
console.log(`\n✨ ${result.finalText}`);
await client.close();
