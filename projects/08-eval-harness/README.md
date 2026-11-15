# 📏 Proyecto 08: Eval Harness

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Un framework de **evaluaciones** para medir los agentes del monorepo con datasets fijos, métricas y comparación entre versiones. Arranca con el caso real del proyecto 06: un `slugify` aprobado por tests y revisor que tenía un bug.

---

## 🧠 Conceptos que cubre

- **Datasets de evaluación:** casos de entrada + resultado esperado, versionados en el repo.
- **Tipos de evaluadores:** exactos (código), basados en propiedades (property-based testing) y **LLM-as-judge** con rúbrica.
- **Regresión:** comparar una versión del agente contra otra (prompt, modelo, motor) y detectar empeoramientos.
- **Validez del juez:** medir cuánto coincide el LLM-as-judge con evaluadores determinísticos.

---

## 📦 Entregables

- [ ] Runner `evals run <suite>` con reporte en consola y JSON (pass rate, costo, latencia).
- [ ] Suites para 01 (calidad de tests generados), 04 (bugs arreglados) y 06 (tareas completas).
- [ ] Evaluador property-based que hubiera detectado el bug de acentos de `slugify`.
- [ ] Comparación de dos corridas: qué casos mejoraron y cuáles empeoraron.

---

## 🔗 Se apoya en

Agentes 01, 04 y 06; `runVitest` y `generateStructured` de `agent-core`.

---

## ✅ Criterio de terminado

El eval detecta el bug de `slugify` que pasó en el proyecto 06, y un cambio de prompt muestra su impacto en el pass rate.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
