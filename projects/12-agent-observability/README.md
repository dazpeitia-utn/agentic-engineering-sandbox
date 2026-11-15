# 📈 Proyecto 12: Agent Observability

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

**Trazas de cada paso** de los agentes: qué pensó, qué tool llamó, cuánto tardó y cuánto costó, en un visor donde se puede depurar una corrida completa.

---

## 🧠 Conceptos que cubre

- **Tracing distribuido:** spans anidados (corrida → nodo → llamada al LLM → tool) con OpenTelemetry.
- **Convenciones GenAI de OpenTelemetry:** atributos estándar para modelo, tokens y costo.
- **Backends:** Langfuse o Jaeger local con Docker.
- **Métricas:** costo por agente, latencia p50/p95, tasa de errores de tools.

---

## 📦 Entregables

- [ ] Instrumentación en `agent-core` (`runAgent`, `StateGraph`, tools) activable por variable de entorno.
- [ ] Docker Compose con el backend de trazas.
- [ ] Trazas de una corrida del 06 con los 4 agentes visibles y su costo.
- [ ] Dashboard con costo y latencia por proyecto.

---

## 🔗 Se apoya en

Todos los proyectos vía `agent-core`.

---

## ✅ Criterio de terminado

Una corrida del 06 se puede inspeccionar paso a paso en el visor, con el costo total y por agente.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
