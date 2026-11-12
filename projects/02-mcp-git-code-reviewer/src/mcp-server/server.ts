import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execAsync = promisify(exec);

const server = new McpServer({
  name: "git-code-reviewer-server",
  version: "1.0.0",
});

server.tool(
  "get_git_status",
  "Obtiene el estado actual de Git (archivos modificados, sin seguimiento o en staging).",
  {},
  async () => {
    try {
      const { stdout } = await execAsync("git status --short");
      return {
        content: [
          {
            type: "text",
            text: stdout.trim() || "El directorio de trabajo está limpio (sin cambios).",
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error ejecutando git status: ${error.message}` }],
      };
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
      const flag = staged ? "--staged" : "";
      const target = filePath ? `-- ${filePath}` : "";
      const { stdout } = await execAsync(`git diff ${flag} ${target}`.trim());

      return {
        content: [
          {
            type: "text",
            text: stdout.trim() || "No hay diferencias (diff vacío) para los parámetros indicados.",
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error ejecutando git diff: ${error.message}` }],
      };
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