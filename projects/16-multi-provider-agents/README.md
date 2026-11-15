# 🔀 Proyecto 16: Multi-Provider Agents

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

El mismo agente corriendo sobre **distintos proveedores** (OpenAI, Anthropic Claude y un modelo local), detrás de una interfaz común, para comparar calidad, costo, latencia y comportamiento del tool calling.

---

## 🧠 Conceptos que cubre

- **Abstracción de proveedor:** diferencias reales entre APIs (mensajes, tool calls, streaming, structured outputs).
- **Claude Agent SDK** y modelos locales (Ollama) frente al SDK de OpenAI.
- **Routing de modelos:** modelo barato para tareas simples, caro para las difíciles, y fallback ante errores.
- **Comparación objetiva:** los mismos evals del 08 sobre cada proveedor.

---

## 📦 Entregables

- [ ] Interfaz `ChatClient` de `agent-core` con adaptadores para OpenAI, Anthropic y Ollama.
- [ ] Agentes 01, 04 y 06 configurables por proveedor (`--provider`).
- [ ] Router de modelos por tipo de tarea, con fallback.
- [ ] Tabla comparativa generada por el eval harness: pass rate, costo y latencia.

---

## 🔗 Se apoya en

`ChatClient` de `agent-core`, agentes existentes y evals del 08.

---

## ✅ Criterio de terminado

El 06 completa la tarea de demo con al menos dos proveedores y la tabla comparativa sale del eval harness.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
