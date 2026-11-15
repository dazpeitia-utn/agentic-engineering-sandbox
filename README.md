# Agentic Engineering Sandbox

Monorepo de proyectos de agentes y servidores MCP.

## Proyectos

| # | Proyecto | Qué cubre | Estado |
|---|----------|-----------|--------|
| 01 | [Agent Unit Tester](projects/01-agent-unit-tester) | Loop ReAct, tool calling, tests que se ejecutan y validan | ✅ |
| 02 | [MCP Git Code Reviewer](projects/02-mcp-git-code-reviewer) | Cliente/servidor MCP, tools dinámicas, git hook pre-push | ✅ |
| 03 | [RAG Docs Assistant](projects/03-rag-docs-assistant) | RAG híbrido (embeddings + BM25 + RRF) con re-ranking | ✅ |
| 04 | [Autonomous Bug Fixer](projects/04-autonomous-bug-fixer) | Stack traces reales, parche y validación con tests | ✅ |
| 05 | [MCP Advanced Server](projects/05-mcp-advanced-server) | Primitivas MCP: resources, prompts y tools seguras | ✅ |
| 06 | [Multi-Agent Orchestrator](projects/06-multi-agent-orchestrator) | Multiagente con grafo de estados: motor propio vs LangGraph | ✅ |
| 07 | [Guardrails & Eval Proxy](projects/07-guardrails-eval-proxy) | Proxy con guardrails: prompt injection, validación de salidas y control de costos | ✅ |
| 08 | [Eval Harness](projects/08-eval-harness) | Evals: datasets, property-based testing, LLM-as-judge y regresiones | ✅ |
| 09 | [Deep Research Agent](projects/09-deep-research-agent) | Deep agent: planificación, subagentes, archivos como memoria y compactación | ✅ |
| 10 | [Human-in-the-Loop Durable Agent](projects/10-human-in-the-loop) | Human-in-the-loop: interrupciones, aprobaciones y ejecución durable | ✅ |
| 11 | [Long-Term Memory Agent](projects/11-long-term-memory) | Memoria de largo plazo: episódica, semántica, actualización y olvido | ✅ |
| 12 | [Agent Observability](projects/12-agent-observability) | Observabilidad: trazas OpenTelemetry, costo y latencia por agente | ✅ |
| 13 | Sandboxed Code Execution | Ejecución de código en contenedores aislados con límites de recursos | 🚧 [PR #16](https://github.com/dazpeitia-utn/agentic-engineering-sandbox/pull/16) |
| 14 | [Remote MCP Server](projects/14-remote-mcp-server) | MCP remoto en producción: Streamable HTTP, OAuth y deploy | ✅ |
| 15 | CI Code Review Agent | Revisor de PRs como GitHub Action con comentarios por línea | 🚧 [PR #18](https://github.com/dazpeitia-utn/agentic-engineering-sandbox/pull/18) |
| 16 | [Multi-Provider Agents](projects/16-multi-provider-agents) | Mismo agente sobre OpenAI, Claude y modelos locales, con routing y comparación | ✅ |
| 17 | [Agent-to-Agent (A2A)](projects/17-agent-to-agent-a2a) | Protocolo A2A: agentes que se descubren y se delegan tareas por la red | ✅ |

✅ terminado · 🚧 planificado (la especificación está en el README de cada carpeta y en su PR en borrador)

## Paquetes compartidos

| Paquete | Qué aporta |
|---------|------------|
| [`packages/agent-core`](packages/agent-core) | Loop ReAct con límite de iteraciones, tools de archivos limitadas a una carpeta, `run_tests` (Vitest), salida estructurada, motor de grafos de estado con checkpoints, cliente OpenAI, carga del `.env` y adaptador de tools MCP. Lo usan todos los proyectos. |

## Setup

Requiere Node.js 22+ y npm 11 (npm 10.9 tiene un bug que rompe la instalación de `vitest`).

```bash
cp .env.example .env # completá OPENAI_API_KEY (un único .env para todo el monorepo)
npm install          # instala todos los workspaces
npm run typecheck    # chequeo de tipos de todos los proyectos
npm test             # tests unitarios (vitest)
npm run hooks:install  # (opcional) code review con IA en cada git push, ver proyecto 02
```
