# 🙋 Proyecto 10: Human-in-the-Loop Durable Agent

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Un agente que **se pausa antes de acciones riesgosas**, espera la aprobación de una persona y **retoma desde donde estaba**, aunque el proceso se haya reiniciado.

---

## 🧠 Conceptos que cubre

- **Interrupciones:** `interrupt()` de LangGraph y su equivalente en el motor propio.
- **Ejecución durable:** checkpoints persistentes (SQLite/Postgres) en vez de memoria.
- **Políticas de aprobación:** qué acciones requieren OK humano (escribir, borrar, gastar, enviar).
- **Editar antes de aprobar:** la persona puede modificar la acción propuesta.

---

## 📦 Entregables

- [ ] Soporte de `interrupt` + `resume` en el `StateGraph` de `agent-core`.
- [ ] Agente de demo (ej: refactor de archivos) que pide aprobación antes de cada escritura.
- [ ] CLI o página web simple para aprobar, rechazar o editar las acciones pendientes.
- [ ] Checkpointer persistente y prueba de matar el proceso a mitad de camino y retomar.

---

## 🔗 Se apoya en

`StateGraph` y checkpoints de `agent-core`, versión LangGraph del 06.

---

## ✅ Criterio de terminado

Se mata el proceso mientras espera una aprobación, se reinicia, se aprueba y la corrida termina correctamente.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
