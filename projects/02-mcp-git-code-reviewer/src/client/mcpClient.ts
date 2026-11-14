import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export class GitMcpClient {
  private client = new Client({ name: "git-code-reviewer-client", version: "1.0.0" }, { capabilities: {} });
  private transport: StdioClientTransport | null = null;

  /** Cliente MCP del SDK, para pasárselo a loadMcpTools. */
  get sdk(): Client {
    return this.client;
  }

  async connect(cwd: string = process.cwd()) {
    const serverScriptPath = path.resolve(__dirname, "../mcp-server/server.ts");
    // Ejecutamos tsx con el mismo Node, sin depender de npx ni del PATH.
    const tsxCli = require.resolve("tsx/cli");

    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [tsxCli, serverScriptPath],
      cwd,
    });

    await this.client.connect(this.transport);
    console.log("🔗 [MCP Client] Conectado exitosamente al servidor MCP de Git.");
  }

  async disconnect() {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      console.log("🔌 [MCP Client] Desconectado del servidor MCP.");
    }
  }
}
