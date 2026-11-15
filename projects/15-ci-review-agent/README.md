# 🤖 Proyecto 15: CI Code Review Agent

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

El revisor del proyecto 02 como **GitHub Action**: revisa cada PR, deja comentarios en las líneas exactas y marca el check como fallido si encuentra problemas críticos.

---

## 🧠 Conceptos que cubre

- **Agentes en CI:** ejecución sin interacción, secretos de CI y permisos mínimos del token.
- **API de GitHub:** reviews con comentarios por línea, checks y estados.
- **Seguridad en CI:** PRs desde forks, prompt injection dentro del diff y `pull_request_target`.
- **Control de ruido:** severidades, deduplicación entre pushes y límite de comentarios.

---

## 📦 Entregables

- [ ] Workflow `.github/workflows/ai-review.yml` que corre el revisor en cada PR.
- [ ] Salida estructurada (archivo, línea, severidad, mensaje) convertida en review comments.
- [ ] Check que falla con severidad crítica, con opción de override por label.
- [ ] Protección contra prompt injection en el diff, probada con un PR malicioso.

---

## 🔗 Se apoya en

Servidor MCP y agente del 02, guardrails del 07.

---

## ✅ Criterio de terminado

Un PR con un bug plantado recibe un comentario en la línea correcta y el check falla; un PR limpio pasa.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
