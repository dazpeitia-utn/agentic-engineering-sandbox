# 🤝 Proyecto 17: Agent-to-Agent (A2A)

Agentes del monorepo expuestos como **servicios independientes** que hablan el protocolo **A2A v1.0**. Un orquestador los **descubre por su Agent Card**, sin conocerlos de antemano, les delega subtareas en paralelo, sigue su progreso y junta los resultados.

```text
                               ┌──────── GET /.well-known/agent-card.json ────────┐
orquestador ── descubre ──────▶│ docs-agent :4101     (RAG del 03)                 │
   │                           │ research-agent :4102 (deep agent del 09)          │
   │  SendMessage (returnImmediately) / GetTask (JSON-RPC, Bearer token)           │
   └── delega en paralelo ────▶│ reviewer-agent :4103 (revisor MCP del 02)         │
                               └───────────────────────────────────────────────────┘
       cada agente es su propio proceso; todos pasan por el proxy de guardrails (07)
```

---

## 🧠 Conceptos

| Concepto | Cómo está hecho |
|---|---|
| **MCP vs A2A** | MCP conecta *un agente con herramientas* (el 02 usa un servidor MCP de git). A2A conecta *agentes entre sí*: cada uno es una caja negra con su propio LLM, tools y memoria, y solo expone tareas. |
| **Agent Card** | `/.well-known/agent-card.json`: nombre, descripción, skills con ejemplos, URL e interfaz (`JSONRPC`, versión 1.0) y esquema de seguridad. El orquestador planifica leyendo **solo** las cards. |
| **Tareas** | Ciclo de vida `submitted → working → (artifact) → completed / failed / canceled`. El executor (`src/a2a.ts`) traduce eso a una función común `async (texto, progress) => resultado`, publica notas de progreso mientras trabaja y devuelve el resultado como artifact. Si tira error, la tarea termina en `failed` con el mensaje. |
| **Tareas largas** | El orquestador manda con `returnImmediately: true` y consulta `GetTask` hasta un estado terminal, mostrando el progreso. El research-agent tarda ~1 minuto y va informando sus subagentes. |
| **Confianza** | Las Agent Cards son públicas; el endpoint JSON-RPC exige `Authorization: Bearer` (`A2A_TOKEN`), con comparación en tiempo constante. La card declara el esquema `bearer`. El token lo inyecta un interceptor del cliente. |
| **SDK oficial** | Servidor y cliente usan [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk) (`DefaultRequestHandler`, `jsonRpcHandler`, `ClientFactory`). Un protocolo con SDK oficial no se reimplementa: el trabajo propio está en los executors y en el orquestador. |

---

## ▶️ Uso

```bash
# Terminal 1: los tres agentes, cada uno en su proceso (recomendado: detrás del proxy del 07)
OPENAI_BASE_URL=http://127.0.0.1:8787/v1 A2A_TOKEN=un-token npm run agents -w 17-agent-to-agent-a2a

# Terminal 2: el orquestador (tarea de demo o la tuya)
OPENAI_BASE_URL=http://127.0.0.1:8787/v1 A2A_TOKEN=un-token npm run orchestrate -w 17-agent-to-agent-a2a
OPENAI_BASE_URL=http://127.0.0.1:8787/v1 A2A_TOKEN=un-token npm run orchestrate -w 17-agent-to-agent-a2a -- "tu tarea"

curl http://127.0.0.1:4102/.well-known/agent-card.json      # ver la card de un agente
npm run agents -w 17-agent-to-agent-a2a -- docs             # levantar uno solo
```

`A2A_AGENTS` cambia la lista de URLs que el orquestador descubre (por default, los tres puertos locales).

---

## 🔬 Corridas reales

Tarea: *"informe sobre MCP para alguien que se suma al equipo: qué es y su historia, cómo se usa en este monorepo y una revisión del último cambio mergeado"*.

**Primera corrida:** el orquestador leyó las 3 cards y repartió bien la tarea (historia → research, uso en el repo → docs, último cambio → reviewer). docs y research terminaron, pero **el reviewer-agent falló: el proxy de guardrails bloqueó su llamada** por "prompt injection". Era un **falso positivo**: el diff que revisaba incluía el README del 07, que *describe* los ataques que detecta ("ignorar instrucciones", "`<system>`"). El orquestador informó la falla y entregó el resto.

**Arreglo** (sin apagar el guardrail):
- El proxy ahora tiene **severidad por agente** (`PROXY_INJECTION_FLAG_AGENTS`). El reviewer es de solo lectura, así que para él la sospecha se **registra** en vez de bloquear: la estrictez depende de lo que el agente puede hacer.
- El lanzador le da a cada servicio su propio `AGENT_ID`. Antes los tres compartían el nombre del paquete y el proxy no podía distinguirlos.

**Segunda corrida:** los tres agentes **completaron en 66 s**. Gasto separado por servicio en el proxy: docs US$0.013 · research US$0.042 · reviewer US$0.049 · orquestador US$0.013. En los logs del reviewer quedó la sospecha de injection como `flag`, y el proxy siguió tachando las contraseñas de ejemplo que aparecen en los tests del diff.

Los tests (`src/a2a.test.ts`) usan el **cliente oficial del SDK** contra servidores reales en puertos libres: descubrimiento de la card, tarea completa, tarea fallida con su mensaje, `returnImmediately` + `GetTask` mientras trabaja, token obligatorio, y el orquestador con LLM falso (delegación en paralelo, síntesis, agentes inexistentes ignorados).

---

## ⚖️ Orquestador local (06) vs agentes distribuidos (17)

| | 06: grafo local | 17: A2A |
|---|---|---|
| Quién define el flujo | El grafo, escrito en código | El orquestador, en tiempo de ejecución, leyendo las cards |
| Acoplamiento | Los agentes comparten estado y proceso | Cajas negras: solo texto de entrada y artifacts de salida |
| Fallas | Un error corta el grafo | Una tarea `failed` no tira a las demás; el orquestador sigue |
| Despliegue | Un proceso | Un servicio por agente, escalable y de equipos distintos |
| Costo | Estado compartido, barato | Cada agente repite contexto; red y auth de por medio |
| Cuándo usarlo | Un equipo, un flujo conocido | Agentes de distintos equipos u organizaciones |

---

## 📂 Estructura

```text
17-agent-to-agent-a2a/
├── src/
│   ├── a2a.ts            # Agent Card, executor (ciclo de vida de la tarea), app express con token
│   ├── agents.ts         # docs-agent (03), research-agent (09), reviewer-agent (02)
│   ├── launch.ts         # Un proceso por agente, cada uno con su AGENT_ID
│   ├── orchestrator.ts   # Descubrimiento, plan, delegación en paralelo, GetTask y síntesis
│   └── a2a.test.ts       # Cliente oficial del SDK contra servidores reales + orquestador
└── runs/                 # Informes del research-agent (ignorado por git)
```
