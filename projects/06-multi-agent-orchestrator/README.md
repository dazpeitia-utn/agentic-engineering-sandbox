# 🕸️ Proyecto 06: Multi-Agent Orchestrator

Orquestador de **cuatro agentes especializados** (Arquitecto, Tester, Desarrollador y Revisor) que colaboran en una tarea de programación mediante un **grafo de estados**. El mismo sistema está implementado **dos veces**: con un motor de grafos propio y con **LangGraph.js**, para comparar los dos enfoques con exactamente los mismos agentes.

---

## 🧭 El grafo

```text
START → 🏛️ architect → 🧪 tester → 💻 developer → ▶️ run_tests ─┬─ pasan ──────────────→ 🔎 reviewer ─┬─ aprobado ───→ END
                                       ▲                       │                                     │
                                       ├── fallan (quedan      │                                     │
                                       │   intentos) ──────────┘                                     │
                                       └──────────── pide cambios (quedan intentos) ─────────────────┘
```

| Nodo | Qué hace | Permisos |
|------|----------|----------|
| 🏛️ `architect` | Convierte la tarea en un plan con **salida estructurada** (JSON Schema): módulo, API, casos de prueba y criterios de aceptación. | No escribe archivos. |
| 🧪 `tester` | Escribe los tests con Vitest **antes** que el código (TDD), a partir del plan. | Solo puede escribir el archivo de tests. |
| 💻 `developer` | Implementa el módulo y verifica con `run_tests`. Si vuelve por un fallo, recibe la salida de Vitest o las observaciones del revisor. | Solo puede escribir el módulo, no los tests. |
| ▶️ `run_tests` | Corre los tests. Es **determinístico** (sin LLM) y es la fuente de verdad para el routing. | — |
| 🔎 `reviewer` | Lee el plan, el código, los tests y el resultado, y da un veredicto estructurado (`approved` + `issues`). | No escribe archivos. |

Cada corrida trabaja en su propia carpeta `workspace/<engine>-<fecha>/` y los agentes no pueden salir de ella (sandbox de [`agent-core`](../../packages/agent-core)). El plan del arquitecto también se valida: las rutas tienen que tener la forma `src/<nombre>.ts`.

---

## ⚖️ Grafo propio vs LangGraph

Los **nodos** (`src/agents.ts`), el **estado** (`src/state.ts`) y el **routing** (`src/routing.ts`) son comunes. Lo único que cambia es el orquestador:

| | Grafo propio (`src/custom/`) | LangGraph (`src/langgraph/`) |
|---|---|---|
| Motor | `StateGraph` de `@sandbox/agent-core` (~200 líneas, sin dependencias) | `StateGraph` de `@langchain/langgraph` |
| Estado | Interfaz TS + `reducers` por campo (`appendReducer`) | `Annotation.Root` con `reducer` y `default` por campo |
| Límite de pasos | `compile({ maxSteps })` | `recursionLimit` al invocar |
| Persistencia | `FileCheckpointer`: un JSON por corrida en `workspace/.checkpoints/` + `resume(threadId)` | `MemorySaver` por `thread_id` + `getState()` (hay checkpointers para Postgres, SQLite, etc.) |
| Streaming | `stream()` → un evento por nodo con el estado completo | `stream({ streamMode: "updates" })` → solo lo que cambió cada nodo |
| Lo que no tiene | Paralelismo, `interrupt()` (human-in-the-loop), subgrafos, tracing | — |
| Para qué sirve | Entender por dentro cómo funciona un grafo de agentes | Producción: persistencia, pausas, observabilidad (LangSmith / Studio) |

Los tests (`src/orchestrator.test.ts`) corren **los dos motores con los mismos agentes falsos** y verifican que recorren el mismo camino y llegan al mismo estado en cada escenario: camino feliz, tests que fallan, revisor que rechaza y máximo de intentos.

---

## ▶️ Uso

```bash
npm start -w 06-multi-agent-orchestrator                          # motor propio, tarea de demo (slugify)
npm start -w 06-multi-agent-orchestrator -- --engine langgraph    # misma tarea con LangGraph
npm start -w 06-multi-agent-orchestrator -- "Implementar una función que valide CUITs argentinos" --max-attempts 4
```

El comando sale con código 0 solo si los tests pasan **y** el revisor aprueba.

---

## 🔬 Lo que mostró una corrida real

Con la tarea de demo (`slugify`), las dos versiones terminaron aprobadas:

| Motor | Camino | Tiempo |
|---|---|---|
| Propio | architect → tester → developer → run_tests → reviewer | 24.6 s |
| LangGraph | architect → tester → developer → run_tests (❌ 1 de 7) → **developer** → run_tests (✅) → reviewer | 31.6 s |

En la corrida de LangGraph se activó el ciclo de reintento: el desarrollador recibió la salida de Vitest y lo corrigió en el segundo intento.

**Pero el código aprobado tenía un bug.** Las tablas de reemplazo de acentos estaban desalineadas por un carácter: `"Fête"` daba `"fite"` y `"Açaí"` daba `"anai"`. Los 7 tests pasaban porque no cubrían `ê` ni `ç`, y el revisor LLM no lo vio. Es una limitación clásica de los sistemas multiagente: **el tester y el revisor también se equivocan**, y "los tests pasan + el LLM aprueba" no alcanza como garantía. Las mitigaciones son evals con datasets fijos, property-based testing y revisores con otra estrategia (o con otro modelo). Esa es la motivación de los próximos proyectos de evals y guardrails.

---

## 📂 Estructura

```text
06-multi-agent-orchestrator/
├── src/
│   ├── state.ts                  # Estado compartido y nombres de nodos
│   ├── agents.ts                 # Los 5 nodos (independientes del motor)
│   ├── routing.ts                # Reglas de las aristas condicionales
│   ├── custom/orchestrator.ts    # Versión 1: StateGraph de agent-core
│   ├── langgraph/orchestrator.ts # Versión 2: LangGraph.js
│   ├── types.ts
│   ├── index.ts                  # CLI (--engine, --max-attempts)
│   └── orchestrator.test.ts      # Equivalencia de motores, routing y validación del plan
└── workspace/                    # Corridas y checkpoints (ignorado por git)
```
