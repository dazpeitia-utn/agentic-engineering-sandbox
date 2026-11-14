import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";

// Inicializamos el servidor MCP
const server = new Server(
  {
    name: "05-mcp-advanced-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// 1. RESOURCES (Datos expuestos por URI)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "config://monorepo-info",
        name: "Monorepo Configuration Info",
        mimeType: "application/json",
        description: "Información general sobre el sandbox de ingeniería agéntica.",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "config://monorepo-info") {
    const info = {
      name: "agentic-engineering-sandbox",
      version: "1.0.0",
      activeProjects: 5,
      stack: ["Node.js", "TypeScript", "MCP", "OpenAI"],
    };
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }
  throw new Error(`Recurso no encontrado: ${request.params.uri}`);
});

// 2. PROMPTS (Plantillas predefinidas)
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "code-audit-template",
        description: "Plantilla de prompt para realizar una auditoría de código.",
        arguments: [
          {
            name: "language",
            description: "Lenguaje de programación a auditar",
            required: true,
          },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === "code-audit-template") {
    const lang = request.params.arguments?.language || "TypeScript";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Por favor, actúa como un Arquitecto de Software Senior y audita el código en ${lang} buscando vulnerabilidades y malas prácticas.`,
          },
        },
      ],
    };
  }
  throw new Error(`Prompt no encontrado: ${request.params.name}`);
});

// 3. TOOLS (Funciones ejecutables)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "readProjectFile",
        description: "Lee un archivo de texto dentro del monorepo de forma segura.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Ruta relativa del archivo a leer.",
            },
          },
          required: ["filePath"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "readProjectFile") {
    const args = request.params.arguments as { filePath: string };
    try {
      const content = await fs.readFile(args.filePath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error al leer el archivo: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
  throw new Error(`Herramienta desconocida: ${request.params.name}`);
});

// Iniciar servidor via Stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 MCP Advanced Server corriendo en stdio");
}

main().catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
