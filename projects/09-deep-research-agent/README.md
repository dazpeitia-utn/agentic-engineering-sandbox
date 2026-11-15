# 🔭 Proyecto 09: Deep Research Agent

Un **deep agent**: investiga una pregunta abierta durante decenas de pasos y entrega un informe en markdown con fuentes verificables. A diferencia del 06 (un *workflow* con grafo fijo), acá **el modelo decide el plan en tiempo de ejecución**. Está implementado dos veces: con un harness propio sobre `agent-core` y con el paquete [`deepagents`](https://www.npmjs.com/package/deepagents) de LangChain, usando las mismas tools.

---

## 🧠 Las cuatro piezas de un deep agent

| Pieza | Cómo está hecha acá | Para qué sirve |
|---|---|---|
| **Planificación** | Tool `write_todos` (`src/tools/planning.ts`). No hace nada en el mundo. | Obliga al agente a escribir su plan y lo mantiene visible aunque la conversación crezca. |
| **Subagentes con contexto aislado** | Tool `task`: lanza un `runAgent` nuevo que **solo ve la descripción de la tarea** y devuelve solo su resultado. Usa un modelo más barato (`gpt-4o-mini`). | Una investigación de 15 pasos no llena el contexto principal. |
| **Archivos como memoria** | `read_file` / `write_file` / `ls` sobre la carpeta de la corrida (`runs/<id>/`); los subagentes dejan notas en `notes/*.md`. | Los hallazgos viven fuera del contexto y se leen cuando hacen falta. |
| **Compactación de contexto** | `compaction` en `runAgent` de [`agent-core`](../../packages/agent-core): si la conversación supera N caracteres, el medio se resume y se conservan el objetivo y los últimos pasos, sin separar nunca una tool call de su resultado. | Tareas largas sin desbordar el contexto. |

Además, **las citas se verifican**: cada documento que una tool lee de verdad recibe un id (`S1`, `S2`...) en un registro (`src/sources.ts`). Al terminar, el informe se valida contra ese registro: citas a fuentes nunca consultadas, fuentes sin usar y párrafos sin cita. Por último, la sección "Fuentes" se **reescribe con las URLs reales**, así el agente no puede inventar links.

Fuentes disponibles: **Wikipedia** (API pública, sin clave, con un fetcher "educado": un request por vez, pausa mínima y reintentos que respetan `Retry-After`) y **la documentación del monorepo** (el RAG híbrido del [proyecto 03](../03-rag-docs-assistant)).

---

## ▶️ Uso

```bash
npm start -w 09-deep-research-agent                                   # pregunta de demo (MCP vs A2A)
npm start -w 09-deep-research-agent -- "¿Qué es RAG y qué técnicas híbridas existen?"
npm start -w 09-deep-research-agent -- --engine deepagents            # misma pregunta con LangChain deepagents
npm start -w 09-deep-research-agent -- "..." --compact-at 12000       # fuerza la compactación para verla en acción

# Recomendado: a través del proxy de guardrails (07), con tope de gasto
OPENAI_BASE_URL=http://127.0.0.1:8787/v1 npm start -w 09-deep-research-agent

# Evaluación con el harness (08)
npm run evals -w 08-eval-harness -- run deep-research
```

El informe queda en `runs/<engine>-<fecha>/report.md` (ignorado por git) junto con las notas de los subagentes.

---

## 🔬 Corridas reales

Pregunta: *"¿Qué es MCP, quién lo creó, cómo se usa en este monorepo y cómo se compara con A2A?"* Todas pasaron por el proxy del 07.

| | Harness propio | LangChain `deepagents` |
|---|---|---|
| Subagentes | 5 (de a uno) | en paralelo |
| Fuentes consultadas / citadas | 10 / 7 | 8 / 4 |
| Citas inventadas | **0** | **0** |
| Párrafos sin cita | 0 | 2 |
| Tiempo · costo | 102 s · US$0.061 | 100 s · US$0.042 |

Con `--compact-at 12000`, en una corrida sobre RAG el contexto bajó de **14.971 a 5.846 caracteres** (12 mensajes resumidos) y la investigación siguió normalmente.

**Lo que aparecieron en la práctica:**
1. **Paralelismo vs. rate limits.** `deepagents` lanza subagentes en paralelo, y la ráfaga contra Wikipedia devolvió **HTTP 429**. Por eso el fetcher serializa los requests y reintenta respetando `Retry-After`.
2. **Una tool que falla no debe tirar la corrida.** En `deepagents`, el error de la tool cortó todo el agente. En `runAgent`, el error vuelve al modelo como texto. El adaptador a LangChain (`src/deepagents.ts`) ahora hace lo mismo.
3. **Citas que existen pero no respaldan la frase.** En un informe, la comparación con A2A citaba el README del proyecto 02, que no habla de A2A. El verificador solo comprueba que la fuente se haya consultado. La *fidelidad* de la cita (que la fuente sostenga lo afirmado) la evalúa el juez del 08.
4. **El juez LLM también se equivoca.** En la suite `deep-research` del 08, el juez le puso 2/5 a un informe correcto: dijo que un dato de 2024 era "imposible porque estamos en 2023", porque juzgaba con su conocimiento de entrenamiento y sin las fuentes. Con la fecha actual y los fragmentos de las fuentes citadas en el prompt, más la instrucción de juzgar solo contra ellos, dio 5/5 y coincidió con los evaluadores determinísticos.

---

## ⚖️ Harness propio vs. `deepagents`

| | Propio (`src/agent.ts`) | `deepagents` (`src/deepagents.ts`) |
|---|---|---|
| Base | `runAgent` de agent-core + 4 tools (~300 líneas) | `createDeepAgent` sobre LangGraph |
| Planificación, subagentes, archivos, compactación | Escritos a mano, visibles y testeables | Incluidos (filesystem virtual en el estado, summarization middleware) |
| Subagentes | Secuenciales | En paralelo |
| Extras | Validación de citas | Skills, memoria, sandboxes, checkpointers, interrupciones (human-in-the-loop) |
| Para qué sirve | Entender cómo funciona por dentro | Producción |

---

## 📂 Estructura

```text
09-deep-research-agent/
├── src/
│   ├── agent.ts              # Deep agent propio: prompts, subagente researcher, compactación
│   ├── deepagents.ts         # La misma investigación con LangChain deepagents
│   ├── tools/planning.ts     # write_todos, task (subagentes), ls, resumidor para compactar
│   ├── tools/research.ts     # Wikipedia (fetcher educado) + docs del monorepo (RAG del 03)
│   ├── sources.ts            # Registro de fuentes S1, S2...
│   ├── citations.ts          # Validación de citas y sección de fuentes real
│   ├── index.ts              # CLI (--engine, --compact-at)
│   └── deepResearch.test.ts  # Corrida completa con LLM falso + tools, citas, fetcher
└── runs/                     # Informes y notas (ignorado por git)
```
