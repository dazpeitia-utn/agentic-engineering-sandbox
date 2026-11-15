# 🙋 Proyecto 10: Human-in-the-Loop Durable Agent

Un agente de refactor que **no toca ningún archivo de código sin aprobación humana**. Propone cambios, se pausa y espera; la persona aprueba, rechaza o edita, y el agente **retoma desde donde estaba**, aunque el proceso se haya cerrado o lo hayan matado en el medio.

---

## 🧠 Conceptos

| Concepto | Cómo está hecho |
|---|---|
| **Interrupciones** | `ctx.interrupt(payload)` dentro de un nodo del `StateGraph` de [`agent-core`](../../packages/agent-core). El grafo guarda un checkpoint con lo que espera y se detiene. `resume(threadId, { resumeValue })` lo retoma: el nodo se re-ejecuta y esta vez `interrupt()` devuelve la respuesta. Es el mismo modelo que `interrupt()` + `Command({ resume })` de LangGraph. |
| **Ejecución durable** | `FileCheckpointer`: un JSON por corrida, con escritura atómica (archivo temporal + rename) y un checkpoint inicial antes del primer nodo. Cada comando de la CLI es **un proceso nuevo**; la corrida vive en disco, no en memoria. |
| **Políticas de aprobación** | `defaultPolicy`: los cambios de código requieren a una persona; los de documentación (`.md`, `.txt`) se aprueban solos. Es una función: se puede cambiar por reglas de riesgo, de costo, etc. |
| **Editar antes de aprobar** | `edit <id> --file <archivo>`: la persona reemplaza el contenido propuesto por el suyo. |
| **Dónde va el interrupt** | En un nodo propio y barato (`review`). Al retomar, el nodo se re-ejecuta desde el principio: si el interrupt estuviera en el mismo nodo que llama al LLM, cada aprobación volvería a llamarlo (y podría proponer otra cosa). |

```text
START → propose (LLM, solo lee) → review ──┬── ⏸️ interrupt por cada cambio de código ──┐
                                   ▲        │   (auto-aprueba la documentación)          │
                                   └────────┘◀── approve / reject / edit (otro proceso) ─┘
                                            └── todos decididos → apply (escribe + corre tests) → END
```

El agente también está limitado: no puede proponer archivos fuera del workspace ni crear archivos nuevos.

---

## ▶️ Uso

```bash
npm run hitl -w 10-human-in-the-loop -- start                 # tarea de demo: renombrar calcPrecio y agregar JSDoc
npm run hitl -w 10-human-in-the-loop -- start "otra tarea"
npm run hitl -w 10-human-in-the-loop -- pending               # aprobaciones pendientes de todas las corridas
npm run hitl -w 10-human-in-the-loop -- approve <id> [--comment "..."]
npm run hitl -w 10-human-in-the-loop -- reject  <id> [--comment "..."]
npm run hitl -w 10-human-in-the-loop -- edit    <id> --file mi-version.ts
npm run hitl -w 10-human-in-the-loop -- resume  <id>          # si el proceso se cortó
```

Cada corrida trabaja sobre una copia de `demo/` en `runs/<id>/workspace/`; los checkpoints quedan en `runs/checkpoints/` (todo ignorado por git).

---

## 🔬 Corridas reales

**Flujo completo, en procesos separados** (US$0.005):
1. `start` → el agente propuso 3 cambios. `README.md` se **auto-aprobó** por la política; el proceso **terminó** esperando la aprobación de `src/carrito.ts`, mostrando el diff.
2. `pending` (otro proceso) → la aprobación seguía ahí, leída del checkpoint.
3. `approve` → pasó al siguiente (`src/precios.ts`, con el JSDoc nuevo).
4. `approve` → aplicó los 3 archivos y **corrió los tests del proyecto: pasan**.
5. `approve` otra vez → error claro: la corrida ya está `done`.

**`kill -9` en medio de la llamada al LLM:** el checkpoint inicial quedó con `next: "propose"`; `resume` desde un proceso nuevo volvió a proponer y siguió hasta la primera aprobación. Este caso lo encontré probando: antes, si el proceso moría en el primer nodo, no había checkpoint para retomar.

Los tests (`src/hitl.test.ts`) cubren aprobar, rechazar (y ver que los tests del proyecto se rompen), editar, durabilidad entre "procesos" con el mismo directorio de checkpoints, que el LLM **no** se vuelve a llamar al retomar, y que no se aceptan archivos fuera del workspace ni nuevos.

---

## ⚖️ Equivalencia con LangGraph

| Este proyecto | LangGraph |
|---|---|
| `ctx.interrupt(payload)` | `interrupt(payload)` |
| `graph.resume(id, { resumeValue })` | `graph.invoke(new Command({ resume }), { configurable: { thread_id } })` |
| `graph.getState(id).interrupt` | `graph.getState(config).tasks[].interrupts` |
| `FileCheckpointer` | `SqliteSaver` / `PostgresSaver` |
| Varios `interrupt()` en un nodo se responden en orden | Igual (por índice) |

Para producción, el checkpointer debería ser una base de datos (SQLite o Postgres) con varias corridas concurrentes y bloqueo por `threadId`, y la aprobación debería llegar por una UI o un mensaje (Slack, mail) en vez de por la CLI.
