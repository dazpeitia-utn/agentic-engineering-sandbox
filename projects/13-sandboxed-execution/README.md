# 📦 Proyecto 13: Sandboxed Code Execution

> **Estado:** 🚧 Planificado. Esta carpeta tiene la especificación; la implementación se hace en el PR de este proyecto.

Los agentes ejecutan código **dentro de contenedores aislados** en vez de en tu máquina, con límites de CPU, memoria, red y tiempo. Es el requisito para darles más autonomía.

---

## 🧠 Conceptos que cubre

- **Aislamiento:** contenedores Docker efímeros, usuario sin privilegios y filesystem de solo lectura salvo el workspace.
- **Límites de recursos:** CPU, memoria, tiempo y red deshabilitada por defecto.
- **Modelo de amenazas:** qué puede hacer un agente comprometido por prompt injection y cómo se contiene.
- **Alternativas:** Docker vs microVMs (Firecracker) vs servicios gestionados.

---

## 📦 Entregables

- [ ] Tool `run_in_sandbox` en `agent-core` (comando + archivos → stdout, stderr, exit code).
- [ ] Imagen base con Node y Vitest, y pool de contenedores reutilizables.
- [ ] Migrar `run_tests` de 01, 04 y 06 a la sandbox (opcional por configuración).
- [ ] Tests de escape: acceso a red, al host y a variables de entorno bloqueados.

---

## 🔗 Se apoya en

`run_tests` de `agent-core` y los agentes 01, 04 y 06.

---

## ✅ Criterio de terminado

El 06 corre completo con la ejecución en contenedores, y los tests de escape confirman que no hay acceso a red, al host ni a secretos.

Al terminar: README con arquitectura y uso, tests, una corrida real documentada y su fila actualizada en el README de la raíz.
