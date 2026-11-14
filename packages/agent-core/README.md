# @sandbox/agent-core

Piezas compartidas por los agentes del monorepo. Cualquier proyecto nuevo lo usa agregando `"@sandbox/agent-core": "*"` a sus `dependencies`.

| Export | Para qué sirve |
|--------|----------------|
| `runAgent(options)` | Loop ReAct: llama al modelo, ejecuta las tools que pide y le devuelve los resultados. Corta en `maxIterations` (default 10), maneja JSON inválido, tools inexistentes y errores de tools sin romper, y trunca salidas largas. |
| `createFsTools({ rootDir, allowWrite })` | Tools `read_file` / `write_file` limitadas a `rootDir` (rechaza `..`, rutas absolutas y symlinks hacia afuera). |
| `loadMcpTools(client)` | Descubre las tools de un servidor MCP y las adapta para `runAgent`. |
| `createOpenAI()` / `defaultModel()` | Cliente OpenAI validando la API key; modelo configurable con `OPENAI_MODEL` (default `gpt-4o`). |
| `loadEnv()` / `requireEnv(name)` | Carga el `.env` único de la raíz del monorepo. |
| `consoleLogger(prefix)` | Logger de eventos del loop (tool calls y resultados). |

## Ejemplo

```ts
import { createFsTools, createOpenAI, defaultModel, runAgent, consoleLogger } from "@sandbox/agent-core";

const result = await runAgent({
  client: createOpenAI(),
  model: defaultModel(),
  system: "Sos un agente que ...",
  user: "Leé src/a.ts y ...",
  tools: createFsTools({ rootDir: "/ruta/al/proyecto" }),
  maxIterations: 8,
  onEvent: consoleLogger(),
});
```

## Tests

`npm test` desde la raíz. Los tests del loop usan un cliente falso, así que no llaman a la API.
