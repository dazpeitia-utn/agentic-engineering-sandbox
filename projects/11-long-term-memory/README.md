# 🧠 Proyecto 11: Long-Term Memory Agent

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Un asistente que **recuerda entre sesiones**: hechos del usuario y del proyecto, decisiones pasadas y lo que funcionó o no, decidiendo qué guardar, qué actualizar y qué olvidar.

---

## 🧠 Conceptos que cubre

- **Tipos de memoria:** de trabajo (contexto), episódica (qué pasó), semántica (hechos) y procedimental (cómo hacer algo).
- **Escritura de memoria:** extracción de hechos, deduplicación y resolución de contradicciones.
- **Recuperación:** búsqueda semántica + recencia + importancia.
- **Olvido y privacidad:** expiración, borrado a pedido y qué nunca guardar.

---

## 📦 Entregables

- [ ] Store de memorias con embeddings (reusa el RAG del 03) y metadatos de recencia e importancia.
- [ ] Agente que lee memorias relevantes al empezar y propone memorias nuevas al terminar.
- [ ] Comandos para ver, editar y borrar memorias.
- [ ] Evals: el agente usa información de sesiones anteriores y no repite memorias duplicadas.

---

## 🔗 Se apoya en

Indexación y búsqueda híbrida del 03, `agent-core`, evals del 08.

---

## ✅ Criterio de terminado

En una sesión nueva el agente usa correctamente un dato contado en una sesión anterior, y actualiza una memoria cuando el dato cambia.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
