# 🤝 Proyecto 17: Agent-to-Agent (A2A)

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Agentes independientes que **se descubren y colaboran por un protocolo estándar**, como MCP pero entre agentes: cada uno publica sus capacidades y los demás le delegan tareas por la red.

---

## 🧠 Conceptos que cubre

- **Protocolo A2A:** Agent Cards (capacidades), tareas con estados, mensajes y artefactos.
- **MCP vs A2A:** MCP conecta un agente con herramientas; A2A conecta agentes entre sí.
- **Tareas de larga duración:** streaming de progreso y notificaciones.
- **Confianza:** autenticación entre agentes y qué delegar a un agente de terceros.

---

## 📦 Entregables

- [ ] Servidores A2A para tres agentes del monorepo (ej: revisor del 02, RAG del 03 y deep agent del 09).
- [ ] Cliente orquestador que descubre los agentes por su Agent Card y les delega subtareas.
- [ ] Demo de una tarea que necesita a los tres agentes.
- [ ] Comparación con el orquestador del 06 (grafo local vs agentes distribuidos).

---

## 🔗 Se apoya en

Agentes 02, 03 y 09, y el orquestador del 06.

---

## ✅ Criterio de terminado

El orquestador resuelve una tarea combinando agentes que corren como servicios separados, descubiertos por su Agent Card.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
