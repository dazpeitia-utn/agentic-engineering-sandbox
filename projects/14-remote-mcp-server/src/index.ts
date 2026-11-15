import { createRemoteMcpApp } from "./server.js";

const port = Number(process.env.PORT ?? 3333);
const publicUrl = new URL(process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}`);
const ownerPassword = process.env.MCP_OWNER_PASSWORD;
if (!ownerPassword || ownerPassword.length < 12) {
  console.error("❌ Definí MCP_OWNER_PASSWORD (12+ caracteres): es la contraseña que aprueba a cada cliente nuevo.");
  process.exit(1);
}
if (publicUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(publicUrl.hostname)) {
  console.error("❌ Fuera de localhost, MCP_PUBLIC_URL tiene que ser https (OAuth 2.1 lo exige).");
  process.exit(1);
}

const { app, mcpUrl } = createRemoteMcpApp({ publicUrl, ownerPassword, log: (l) => console.log(l) });
app.listen(port, process.env.HOST ?? "0.0.0.0", () => {
  console.log(`🌐 MCP remoto en ${mcpUrl}`);
  console.log(`   Metadata OAuth: ${new URL("/.well-known/oauth-authorization-server", publicUrl)}`);
  console.log(`   Claude Code:    claude mcp add --transport http monorepo ${mcpUrl}`);
});
