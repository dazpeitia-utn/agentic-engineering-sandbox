# 🔭 Proyecto 09: Deep Research Agent

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Un **deep agent**: investiga un tema abierto durante decenas de pasos y entrega un informe con fuentes. A diferencia del 06 (workflow con grafo fijo), acá **el modelo decide el plan** en tiempo de ejecución.

---

## 🧠 Conceptos que cubre

- **Herramienta de planificación:** `write_todos`, una lista de tareas que el propio agente mantiene.
- **Subagentes con contexto aislado:** el agente principal delega subtareas y recibe solo el resultado.
- **Sistema de archivos como memoria:** notas y borradores en archivos en vez de en el contexto.
- **Manejo de contexto:** compactación y resumen cuando la conversación crece.
- **Workflow vs agente:** cuándo conviene cada uno (comparación con el 06).

---

## 📦 Entregables

- [ ] Deep agent sobre `agent-core` con `write_todos`, `task` (subagentes), filesystem virtual y compactación.
- [ ] Fuentes: búsqueda web y el RAG del proyecto 03 como tools.
- [ ] Informe final en markdown con citas verificables.
- [ ] Versión comparativa con el paquete `deepagents` de LangChain.
- [ ] Evaluación con el harness del 08 (cobertura de la pregunta, fuentes reales, alucinaciones).

---

## 🔗 Se apoya en

`runAgent`, `createFsTools`, el RAG del 03 y el eval harness del 08.

---

## ✅ Criterio de terminado

Resuelve una pregunta que necesita más de 20 pasos sin perder el objetivo, y el informe pasa los evals de fuentes y alucinaciones.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
