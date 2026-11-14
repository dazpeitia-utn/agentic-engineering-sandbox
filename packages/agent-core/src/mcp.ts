import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AgentTool } from "./tools.js";

/**
 * Descubre las tools de un servidor MCP y las adapta al formato de AgentTool,
 * para que el loop las pueda usar igual que a las tools locales.
 */
export async function loadMcpTools(client: Pick<Client, "listTools" | "callTool">): Promise<AgentTool[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema as Record<string, unknown>,
    async execute(args: Record<string, unknown>) {
      const result = await client.callTool({ name: tool.name, arguments: args });
      const text = Array.isArray(result.content)
        ? result.content.map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")
        : JSON.stringify(result);
      if (result.isError) throw new Error(text);
      return text;
    },
  }));
}
