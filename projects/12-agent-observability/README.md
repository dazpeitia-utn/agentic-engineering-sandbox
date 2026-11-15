# 📈 Proyecto 12: Agent Observability

**Trazas de cada paso de los agentes**: qué nodo corrió, qué le pidió al LLM, cuántos tokens usó, qué tools llamó, cuánto tardó y cuánto costó. Todo con **OpenTelemetry**, y sin tocar el código de los proyectos.

---

## 🧱 Cómo está hecho

| Pieza | Qué hace |
|---|---|
| **Instrumentación en [`agent-core`](../../packages/agent-core)** (`src/tracing.ts`) | Depende **solo de `@opentelemetry/api`**: si nadie registra un SDK, los spans son no-op y no cuestan nada (es la práctica recomendada para librerías). Spans con las **convenciones GenAI de OpenTelemetry**: `invoke_agent {nombre}` → `chat {modelo}` (`gen_ai.request.model`, `gen_ai.usage.input_tokens/output_tokens`, `finish_reasons`) → `execute_tool {tool}` (marcado como error si la tool falla). El `StateGraph` agrega `graph.run` / `graph.resume` → `graph.node {nodo}`, con un evento si el nodo se interrumpe. La compactación de contexto queda como evento. |
| **Preload** (`src/register.mjs`) | Registra el SDK con `--import` **antes** de que arranque la app: cualquier proyecto queda instrumentado con `NODE_OPTIONS`. El servicio se llama como `AGENT_ID` o el paquete de npm. |
| **Exporters** | JSONL en `traces/` siempre (escritura síncrona: no se pierden spans si la app termina con `process.exit`), y OTLP/HTTP si está definida `OTEL_EXPORTER_OTLP_ENDPOINT`. |
| **Visor** (`src/viewer.ts`) | Genera `traces/report.html`: un tablero por servicio (costo, latencia p50/p95, llamadas al LLM y tasa de errores de tools) y la **cascada de spans** de cada corrida, con modelo, tokens y costo por llamada. El costo usa los precios del [proxy 07](../07-guardrails-eval-proxy). HTML estático, con modo oscuro y sin JavaScript. |
| **Jaeger** (`docker-compose.yml`) | Para ver las mismas trazas en una UI estándar. |

---

## ▶️ Uso

```bash
# Instrumentar cualquier proyecto, sin cambios de código
NODE_OPTIONS="--import $PWD/projects/12-agent-observability/src/register.mjs" npm start -w 06-multi-agent-orchestrator

# Tablero + cascadas
npm run report -w 12-agent-observability      # → projects/12-agent-observability/traces/report.html

# Opcional: Jaeger (necesita Docker)
docker compose -f projects/12-agent-observability/docker-compose.yml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 NODE_OPTIONS="--import $PWD/projects/12-agent-observability/src/register.mjs" npm start -w 04-autonomous-bug-fixer
```

> El `docker-compose.yml` **no está probado**: durante el desarrollo, Docker no estaba corriendo. El exporter OTLP es el estándar de OpenTelemetry; todo lo demás se verificó con el exporter JSONL y el visor.

---

## 🔬 Corridas reales

El 06 (orquestador) y el 04 (bug fixer), instrumentados solo con `NODE_OPTIONS` y pasando por el proxy del 07:

| Servicio | Corridas | Costo | Latencia | LLM | Tools |
|---|---|---|---|---|---|
| 06-multi-agent-orchestrator | 1 | US$0.045 | 18.4 s | 10 | 6 |
| 04-autonomous-bug-fixer | 1 | US$0.020 | 5.9 s | 5 | 4 |

La cascada del 06 muestra `graph.run` → `graph.node architect / tester / developer / run_tests / reviewer` → agentes → llamadas. De un vistazo se ve que **el desarrollador ocupa la mitad de la corrida** (9.2 de 18.4 s, con 5 llamadas al LLM): ahí convendría optimizar.

**Lo que salió en el camino:**
- **OpenTelemetry cambió de API.** `sdk-trace-node` 2.x no es compatible con la `api` 1.10, y el paquete nuevo es `@opentelemetry/sdk-trace` 3.x, donde los processors reciben `{ exporter }`.
- **Importar el preload en un test lo registraba globalmente,** y como OpenTelemetry acepta un solo provider global, el del test no tenía efecto. La serialización pasó a un módulo sin efectos secundarios.
- **`withSpan` marcaba OK al terminar y pisaba el error que había marcado la tool.** Por convención, el éxito queda `UNSET`.
- **Cada nodo del grafo arrancaba su propia traza** (el 06 aparecía como 5 corridas). Faltaba un span raíz, y en un generador asíncrono el contexto activo no sobrevive entre `yield`. Ahora hay un `graph.run` y cada nodo se ejecuta explícitamente dentro de su contexto.

Los tests (`src/tracing.test.ts`) registran un provider en memoria y verifican la jerarquía, los atributos GenAI, el error de tool, que toda la corrida de un grafo sea **una sola traza** y el visor (árbol, costo, métricas y HTML).
