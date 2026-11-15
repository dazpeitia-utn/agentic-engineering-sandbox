# 📦 Proyecto 13: Sandboxed Code Execution

Los agentes ejecutan el código que escriben (tests, scripts) **dentro de contenedores aislados** en vez de en tu máquina. Es el requisito para darles más autonomía: el código que escribe un LLM puede venir de un prompt injection, y hay que tratarlo como hostil.

---

## 🛡️ Modelo de amenazas

Supuesto: el código que corre en el sandbox lo controla un atacante (por ejemplo, un archivo leído por el agente que contenía una inyección). Cada amenaza y su contención:

| Ataque | Contención | Flag de `docker run` |
|---|---|---|
| Exfiltrar datos o descargar malware | Sin red | `--network none` |
| Leer secretos (`OPENAI_API_KEY`, tokens) | No se hereda el entorno del host: solo variables explícitas | (sin `-e` implícitos) |
| Leer o modificar archivos del host | Solo se monta la carpeta de trabajo; el resto, de solo lectura | `-v ws:/workspace`, `--read-only`, `--tmpfs /tmp` |
| Escalar privilegios | Usuario sin privilegios, sin capabilities | `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges` |
| Agotar la memoria del host | Límite sin swap extra | `--memory 512m --memory-swap 512m` |
| Fork bomb | Límite de procesos | `--pids-limit 128` |
| Loop infinito | Timeout que mata el contenedor por nombre | `docker kill` |
| Acaparar CPU | Límite de CPU | `--cpus 1` |

**Lo que Docker NO cubre:** comparte el kernel con el host. Un exploit del kernel podría escapar. Para ejecutar código de terceros a escala se usa una **microVM** (Firecracker, como en AWS Lambda) o un kernel en espacio de usuario (**gVisor**). Para un agente de desarrollo en tu máquina, Docker con estas restricciones es un buen equilibrio.

---

## 🧱 Cómo está hecho

- **`agent-core/src/sandbox.ts`:**
  - `runInSandbox(command, options)` crea un contenedor efímero por ejecución.
  - `dockerRunArgs` es una función pura y testeable con todos los flags de la tabla.
  - Detecta OOM (exit 137 sin timeout).
  - `createSandboxTool` expone la tool `run_in_sandbox` para agentes.
  - `runVitestInSandbox` corre los tests adentro.
- **Integración sin tocar los proyectos:** con `AGENT_SANDBOX=docker`, `runVitest` de agent-core corre en el sandbox. Así quedan aislados la tool `run_tests` y las verificaciones independientes de los agentes 01, 04 y 06.
- **Imagen** (`image/Dockerfile`): Node 22 + Vitest **para Linux** en `/node_modules`, usuario sin privilegios. El workspace se monta en `/workspace` y Node resuelve `vitest` subiendo directorios. No se puede montar el `node_modules` del host porque trae binarios nativos de macOS (esbuild).

---

## ▶️ Uso

```bash
# 1. Abrir Docker Desktop, y una vez:
npm run build-image -w 13-sandboxed-execution

# 2. Tests de escape contra Docker real
npm run escape-tests -w 13-sandboxed-execution

# 3. Agentes con los tests aislados
AGENT_SANDBOX=docker npm start -w 04-autonomous-bug-fixer
AGENT_SANDBOX=docker npm start -w 06-multi-agent-orchestrator
```

---

## 🔬 Verificación con Docker real

**Tests de escape** (`src/escape.test.ts`), 10 de 10 contra Docker 27.4:

| Ataque | Resultado |
|---|---|
| `fetch("https://example.com")` | ❌ Bloqueado: sin red |
| Leer `OPENAI_API_KEY` del host | ❌ No aparece en `env` |
| `touch /etc/pwned`, `touch /usr/pwned`, `ls /Users` | ❌ *Read-only file system* / *No such file or directory* (solo `/workspace` es escribible) |
| ¿Soy root? ¿Tengo capabilities? | uid **1000**, `CapEff: 0000000000000000` |
| Reservar 1 GB con un límite de 256 MB | Cortado por el kernel |
| **Fork bomb**: 400 procesos con un límite de 64 | Límite **64**: se crearon **57** (los otros 7 son hilos del propio Node) y **fallaron 343**, en 1 s. Un shell que agota el límite directamente **aborta** (`Cannot fork`). |
| `while(true){}` con timeout de 3 s | Cortado; **no queda ningún contenedor vivo** |
| Vitest adentro | ✅ Corre aislado, sin códigos de color en la salida |

**Criterio de terminado:** con `AGENT_SANDBOX=docker`, el **orquestador 06 completó la tarea** (arquitecto → tester → desarrollador → tests 6/6 **dentro del sandbox** → revisor aprobó) en 42 s, contra unos 18 s sin sandbox. Se vieron 3 contenedores efímeros durante la corrida, todos eliminados.

**Lo que apareció al verificar:**
- **El mismo bug de npm 10.9** (`edgesOut`) que encontramos al principio del monorepo, ahora **dentro de la imagen** (`node:22-slim` trae npm 10.9.9). La imagen instala con npm 11.
- **El primer test de la fork bomb estaba mal diseñado:** los `sleep &` heredaban el pipe de `| tail` y el test medía eso, no el límite. Después, el shell no podía ni crear el subproceso de un `$(...)` para informar, porque el límite ya estaba agotado. Ese era justamente el comportamiento buscado. Ahora se mide con Node, que captura cada `spawn` fallido.
- **La salida de Vitest en el contenedor traía códigos de color ANSI**, que ensucian lo que lee el LLM. Ahora se desactivan.
- **El sandbox tiene un costo:** cada ejecución de tests crea un contenedor (~0.6 s de arranque). En el 06 la corrida pasó de ~18 s a 42 s. Un *pool* de contenedores reutilizables lo reduciría, a cambio de limpiar el estado entre usos.

---

## 🧪 Tests

- **Sin Docker** (`src/sandbox.test.ts`, corren siempre): los flags de aislamiento, que solo pasen las variables explícitas, timeout que mata el contenedor por nombre, detección de OOM, Vitest adentro y rechazo de rutas fuera del workspace.
- **Escape, con Docker real** (`src/escape.test.ts`, se saltean solos si no hay daemon o falta la imagen): intentan salir a internet, leer `OPENAI_API_KEY`, escribir en `/etc` y `/usr`, leer `/Users`, ser root o tener capabilities, usar 1 GB de memoria, una fork bomb y un loop infinito; y verifican que Vitest funcione adentro.
Si algún test de escape falla, ese es justamente el valor del test: hay que ajustar los flags antes de confiarle código a la sandbox.
