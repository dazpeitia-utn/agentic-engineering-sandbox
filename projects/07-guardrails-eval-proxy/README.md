# 🛡️ Proyecto 07: Guardrails & Eval Proxy

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Un **proxy middleware** entre los agentes y el LLM que valida entradas y salidas, detecta prompt injection, controla costos y registra cada llamada. Los agentes no cambian: solo apuntan al proxy en vez de a la API.

---

## 🧠 Conceptos que cubre

- **Guardrails de entrada:** detección de prompt injection (heurísticas + clasificador LLM), PII y secretos en el prompt.
- **Guardrails de salida:** validación con JSON Schema, filtros de contenido, detección de secretos filtrados.
- **Control de costos:** presupuesto por agente/corrida, conteo de tokens, rate limiting y corte al superar el límite.
- **Patrón proxy/middleware:** cadena de interceptores componibles (como middlewares de Express).

---

## 📦 Entregables

- [ ] Servidor HTTP compatible con la API de Chat Completions (los agentes usan `baseURL` del proxy).
- [ ] Pipeline de guardrails configurable, con cada regla como un módulo testeable.
- [ ] Presupuestos por `x-agent-id` y reporte de costo por corrida.
- [ ] Log estructurado de cada llamada (entrada, salida, latencia, tokens, reglas disparadas).
- [ ] Integración opcional en `agent-core` (`createOpenAI({ viaProxy: true })`).

---

## 🔗 Se apoya en

`agent-core` (cliente OpenAI), agentes 01–06 como clientes de prueba.

---

## ✅ Criterio de terminado

Un ataque de prompt injection conocido queda bloqueado, una corrida que supera su presupuesto se corta, y los agentes existentes funcionan a través del proxy sin cambios de código.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
