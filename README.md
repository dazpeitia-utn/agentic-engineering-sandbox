# Agentic Engineering Sandbox

Monorepo de proyectos de agentes y servidores MCP.

## Proyectos

| # | Proyecto | Carpeta |
|---|----------|---------|
| 01 | Agent Unit Tester | [`projects/01-agent-unit-tester`](projects/01-agent-unit-tester) |
| 02 | MCP Git Code Reviewer | [`projects/02-mcp-git-code-reviewer`](projects/02-mcp-git-code-reviewer) |
| 03 | RAG Docs Assistant | [`projects/03-rag-docs-assistant`](projects/03-rag-docs-assistant) |
| 04 | Autonomous Bug Fixer | [`projects/04-autonomous-bug-fixer`](projects/04-autonomous-bug-fixer) |
| 05 | MCP Advanced Server | [`projects/05-mcp-advanced-server`](projects/05-mcp-advanced-server) |

## Paquetes compartidos

| Paquete | Qué aporta |
|---------|------------|
| [`packages/agent-core`](packages/agent-core) | Loop ReAct con límite de iteraciones, tools de archivos limitadas a una carpeta, cliente OpenAI, carga del `.env` y adaptador de tools MCP. Lo usan 01, 02, 03 y 04. |

## Setup

Requiere Node.js 22+ y npm 11 (npm 10.9 tiene un bug que rompe la instalación de `vitest`).

```bash
cp .env.example .env # completá OPENAI_API_KEY (un único .env para todo el monorepo)
npm install          # instala todos los workspaces
npm run typecheck    # chequeo de tipos de todos los proyectos
npm test             # tests unitarios (vitest)
```
