# 🌐 Proyecto 14: Remote MCP Server

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Llevar un servidor MCP **a producción**: transporte Streamable HTTP, autenticación OAuth, deploy en la nube y conexión desde clientes reales (Claude, IDEs, otros agentes).

---

## 🧠 Conceptos que cubre

- **Transportes MCP:** stdio (local) vs Streamable HTTP (remoto), sesiones y reconexión.
- **Autorización:** OAuth 2.1 con PKCE según la especificación de MCP, scopes por tool.
- **Operación:** rate limiting, logs, health checks y versionado de tools.
- **Seguridad:** validación estricta de entradas y aislamiento por usuario.

---

## 📦 Entregables

- [ ] Evolución del servidor del 05 con transporte Streamable HTTP.
- [ ] Flujo OAuth completo y tools con permisos por scope.
- [ ] Deploy (ej: Fly.io, Railway o Cloud Run) con Dockerfile y CI.
- [ ] Guía para conectarlo desde Claude Code y desde un agente del monorepo.

---

## 🔗 Se apoya en

Servidor del 05, `loadMcpTools` de `agent-core`.

---

## ✅ Criterio de terminado

Un cliente MCP remoto se autentica con OAuth, lista y usa las tools, y un usuario sin el scope correcto es rechazado.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
