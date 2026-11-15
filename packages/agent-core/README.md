# @sandbox/agent-core

Piezas compartidas por los agentes del monorepo. Cualquier proyecto nuevo lo usa agregando `"@sandbox/agent-core": "*"` a sus `dependencies`.

| Export | Para qué sirve |
|--------|----------------|
| `runAgent(options)` | Loop ReAct: llama al modelo, ejecuta las tools que pide y le devuelve los resultados. Corta en `maxIterations` (default 10), maneja JSON inválido, tools inexistentes y errores de tools sin romper, y trunca salidas largas. |
| `createFsTools({ rootDir, allowWrite, canWrite })` | Tools `read_file` / `write_file` limitadas a `rootDir` (rechaza `..`, rutas absolutas y symlinks hacia afuera). `canWrite` filtra qué archivos puede escribir el agente. |
| `createRunTestsTool({ rootDir })` / `runVitest(rootDir, file)` | Tool `run_tests` para que el agente ejecute Vitest y lea el resultado (con stack traces); `runVitest` sirve para verificar desde el código. |
| `generateStructured<T>({ schema, ... })` | Respuesta del modelo que cumple un JSON Schema estricto (structured outputs), ya parseada. |
| `StateGraph` / `START` / `END` | Motor de grafos de estado al estilo LangGraph: nodos que devuelven actualizaciones parciales, reducers por campo (`appendReducer`), aristas fijas y condicionales, `maxSteps`, `invoke` / `stream` y checkpoints (`MemoryCheckpointer`, `FileCheckpointer` con escritura atómica) con `resume(threadId)`. Los nodos reciben `ctx.interrupt(payload)` para pausar y esperar a una persona (human-in-the-loop, proyecto 10). |
| `runAgent({ compaction })` | Compactación de contexto para tareas largas: resume los mensajes del medio sin separar tool calls de sus resultados (proyecto 09). |
| Trazas (OpenTelemetry) | `runAgent`, `generateStructured` y `StateGraph` generan spans con convenciones GenAI (`invoke_agent`, `chat`, `execute_tool`, `graph.run`, `graph.node`). Solo dependen de `@opentelemetry/api`: sin SDK registrado no hacen nada. `runAgent({ name })` nombra al agente en las trazas (proyecto 12). |
| `createLLM()` / `createChatClient(provider)` | Proveedor según `LLM_PROVIDER`: `openai`, `anthropic` (adaptador a la API de Messages), `ollama` o `router` (`routedClient` con fallback, circuit breaker y `costAwareSelect`). Proyecto 16. |
| `runInSandbox` / `createSandboxTool` / `runVitestInSandbox` | Ejecución en contenedores Docker aislados (sin red, sin secretos, solo lectura, sin root, con límites). Con `AGENT_SANDBOX=docker`, `runVitest` corre en el sandbox (proyecto 13). |
| `loadMcpTools(client)` | Descubre las tools de un servidor MCP y las adapta para `runAgent`. |
| `createOpenAI()` / `defaultModel()` | Cliente OpenAI validando la API key; modelo configurable con `OPENAI_MODEL` (default `gpt-4o`). Respeta `OPENAI_BASE_URL` y, si apunta a un proxy (proyecto 07), manda `x-agent-id` / `x-run-id`. |
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

## Ejemplo de grafo

```ts
import { StateGraph, START, END, appendReducer } from "@sandbox/agent-core";

const graph = new StateGraph<{ count: number; log: string[] }>({ log: appendReducer })
  .addNode("inc", (s) => ({ count: s.count + 1, log: [`inc ${s.count + 1}`] }))
  .addEdge(START, "inc")
  .addConditionalEdges("inc", (s) => (s.count >= 3 ? END : "inc"), ["inc", END])
  .compile({ maxSteps: 10 });

await graph.invoke({ count: 0, log: [] }); // { count: 3, log: ["inc 1", "inc 2", "inc 3"] }
```

## Tests

`npm test` desde la raíz. Los tests del loop usan un cliente falso, así que no llaman a la API.
