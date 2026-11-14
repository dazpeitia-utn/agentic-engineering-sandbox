# 🔌 Proyecto 05: MCP Advanced Server

Servidor avanzado basado en el **Model Context Protocol (MCP)** desarrollado con TypeScript y el SDK oficial de Anthropic. Este proyecto implementa las tres primitivas principales del estándar:

1. **Resources:** Datos vivos expuestos mediante URIs estandarizadas (`config://monorepo-info`, calculado en el momento a partir de `projects/` y `packages/`).
2. **Prompts:** Plantillas de instrucciones predefinidas para tareas de desarrollo (`code-audit-template`).
3. **Tools:** `readProjectFile`, lectura de archivos del monorepo con rutas relativas a su raíz.

## 🔒 Seguridad de `readProjectFile`

Este servidor se puede conectar a clientes como Claude Code, así que la tool está restringida (ver `src/files.ts`):

* Solo lee dentro del monorepo: rechaza `..`, rutas absolutas y symlinks que apunten afuera (usa `resolveInside` de [`agent-core`](../../packages/agent-core)).
* Nunca expone secretos ni internos: bloquea `.env` / `.env.*` (salvo `.env.example`), `.git/` y `node_modules/`.
* Límite de 200 KB por archivo.

## ▶️ Uso

```bash
npm start -w 05-mcp-advanced-server   # servidor MCP por stdio
npm test                              # incluye los tests de src/files.test.ts
```
