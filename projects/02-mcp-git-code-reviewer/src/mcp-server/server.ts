import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gitDiff, gitStatus } from "./git.js";

const server = new McpServer({
  name: "git-code-reviewer-server",
  version: "1.0.0",
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const errorText = (t: string) => ({ isError: true, ...text(t) });

server.tool(
  "get_git_status",
  "Obtiene el estado actual de Git (archivos modificados, sin seguimiento o en staging).",
  {},
  async () => {
    try {
      return text(await gitStatus());
    } catch (error: any) {
      return errorText(`Error ejecutando git status: ${error.message}`);
    }
  }
);

server.tool(
  "get_git_diff",
  "Obtiene el diff de Git para revisar los cambios en el código. Puede filtrar por un archivo específico o incluir cambios en staging.",
  {
    staged: z.boolean().optional().describe("Si es true, muestra los cambios en staging (--staged)."),
    filePath: z.string().optional().describe("Ruta opcional de un archivo específico para inspeccionar."),
  },
  async ({ staged, filePath }) => {
    try {
      return text(await gitDiff({ staged, filePath }));
    } catch (error: any) {
      return errorText(`Error ejecutando git diff: ${error.message}`);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Servidor MCP de Git iniciado y escuchando por stdio...");
}

main().catch((error) => {
  console.error("Error fatal en el servidor MCP:", error);
  process.exit(1);
});
