import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GitMcpClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client(
      {
        name: "git-code-reviewer-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
  }

  async connect() {
    const serverScriptPath = path.resolve(__dirname, "../mcp-server/server.ts");

    this.transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", serverScriptPath],
    });

    await this.client.connect(this.transport);
    console.log("🔗 [MCP Client] Conectado exitosamente al servidor MCP de Git.");
  }

  async listAvailableTools() {
    const response = await this.client.listTools();
    return response.tools;
  }

  async callTool(name: string, argumentsObj: any = {}) {
    const result = await this.client.callTool({
      name,
      arguments: argumentsObj,
    });
    return result;
  }

  async disconnect() {
    if (this.transport) {
      await this.transport.close();
      console.log("🔌 [MCP Client] Desconectado del servidor MCP.");
    }
  }
}
