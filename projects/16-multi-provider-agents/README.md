# 🔀 Proyecto 16: Multi-Provider Agents

Los mismos agentes sobre **distintos proveedores de LLM** (OpenAI, Anthropic Claude y modelos locales con Ollama) detrás de una interfaz común, con un **router** que elige modelo por tipo de pedido y hace fallback, y una **comparación objetiva** con el eval harness del 08.

---

## 🧱 Cómo está hecho (en [`agent-core`](../../packages/agent-core))

| Pieza | Qué hace |
|---|---|
| **Interfaz común** | `ChatClient`, con la forma de chat completions. `runAgent`, `generateStructured` y los grafos ya la usaban: los agentes no saben qué proveedor tienen detrás. |
| **Adaptador de Anthropic** (`providers.ts`) | Traduce a la API de Messages: el system va aparte; las tool calls pasan a bloques `tool_use` y los resultados a `tool_result`; los mensajes seguidos del mismo rol se fusionan (Anthropic exige alternar). La **salida estructurada** se emula con una tool forzada (`tool_choice`) cuyo input es la respuesta. La respuesta vuelve con forma de ChatCompletion (texto, `tool_calls`, uso, `finish_reason`). Usa `fetch`, sin SDK extra. |
| **Ollama** | Usa su API compatible con OpenAI: el mismo SDK con `baseURL=http://localhost:11434/v1`. |
| **`createLLM()`** | Elige proveedor con `LLM_PROVIDER` (`openai`, `anthropic`, `ollama`, `router`) y el modelo por defecto de cada uno (`OPENAI_MODEL`, `ANTHROPIC_MODEL`, `OLLAMA_MODEL`). Los agentes 01, 04 y 06 lo usan; los que necesitan embeddings (03, 11) siguen con OpenAI. |
| **Router** (`router.ts`) | `routedClient` prueba destinos en orden y hace **fallback** solo ante errores que tiene sentido reintentar en otro lado: proveedor no configurado, 401/403, 429, 5xx, error de red. Ante un 400 no: fallaría igual en otro proveedor y se gastaría dos veces. Tiene **circuit breaker**: un proveedor sin configurar se saltea el resto de la corrida. `costAwareSelect` manda los pedidos simples (sin tools, poco contexto) al modelo barato y el resto al fuerte, siempre con el otro de fallback. |

---

## ▶️ Uso

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm start -w 04-autonomous-bug-fixer
LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.1 npm start -w 06-multi-agent-orchestrator
LLM_PROVIDER=router ROUTER_VERBOSE=1 npm start -w 04-autonomous-bug-fixer    # baratos → gpt-4o-mini / Haiku; fuertes → Sonnet / gpt-4o

# Comparar modelos con una suite del eval harness (08)
npm run compare -w 16-multi-provider-agents -- bug-fixer gpt-4o-mini gpt-4o --repeats 2
LLM_PROVIDER=anthropic npm run compare -w 16-multi-provider-agents -- bug-fixer claude-haiku-5-5 claude-sonnet-5-5
```

---

## 🔬 Resultados reales

### Comparación (eval harness del 08, a través del proxy del 07)

**Bug fixer (04)**, 4 casos × 2:

| Modelo | Pass rate | Costo total | Costo por caso aprobado | p50 | p95 |
|---|---|---|---|---|---|
| openai:gpt-4o-mini | 100% (8/8) | US$0.0081 | **US$0.0010** | 11.7 s | 16.2 s |
| openai:gpt-4o | 100% (8/8) | US$0.1448 | US$0.0181 | 9.5 s | 10.5 s |

**Orquestador multiagente (06)**, 3 tareas:

| Modelo | Pass rate | Costo total | Costo por caso aprobado | p50 | p95 |
|---|---|---|---|---|---|
| openai:gpt-4o-mini | 67% (2/3) | US$0.0348 | US$0.0174 | 44.9 s | **146.6 s** |
| openai:gpt-4o | 67% (2/3) | US$0.2090 | US$0.1045 | 18.2 s | 33.0 s |

**Lectura:** en el bug fixer, gpt-4o-mini rinde igual por **18 veces menos**. En el orquestador también aprueba lo mismo y cuesta 6 veces menos, pero en las tareas difíciles **agota los reintentos y tarda hasta 4 veces más**. Los dos modelos fallaron `slugify`, con bugs distintos (gpt-4o deja pasar `"#"`; mini rompe con `"Â"`). Conclusión: no hay un "mejor modelo", hay un mejor modelo **por tarea**, y para eso sirven el router y el eval harness.

### Fallback real

Sin `ANTHROPIC_API_KEY`, con `LLM_PROVIDER=router` el agente 04 arregló el bug igual: los pedidos "fuertes" (con tools) intentaron Claude Sonnet, que no estaba disponible, y pasaron a gpt-4o. En la primera versión el router reintentaba Anthropic en **cada** llamada (5 veces). Con el circuit breaker lo intenta **una sola vez**.

> **No probado contra las APIs reales de Anthropic ni Ollama:** no había API key de Anthropic ni Ollama instalado. El adaptador de Anthropic está cubierto por tests con un `fetch` falso, que incluyen un `runAgent` completo con tools y la salida estructurada. Para probarlo de verdad: `LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run compare -w 16-multi-provider-agents -- bug-fixer claude-haiku-5-5`.

---

## 📂 Dónde está cada cosa

```text
packages/agent-core/src/providers.ts       # adaptador de Anthropic, createChatClient, createLLM
packages/agent-core/src/router.ts          # routedClient (fallback + circuit breaker), costAwareSelect
packages/agent-core/src/providers.test.ts  # traducción de ida y vuelta, salida estructurada, agente completo, router
projects/16-multi-provider-agents/src/compare.ts   # tabla comparativa con el eval harness
```
