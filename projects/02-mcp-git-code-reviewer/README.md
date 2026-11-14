# 02 - MCP Git Code Reviewer (Agente Revisor de Código con Model Context Protocol)

Un agente autónomo en **TypeScript** que implementa la arquitectura **Model Context Protocol (MCP)** de Anthropic. El sistema separa la lógica del LLM (Cliente/Agente) de las capacidades del sistema operativo (Servidor MCP de Git) para realizar revisiones de código automáticas sobre los cambios locales del repositorio.

---

## 🧠 Conceptos Clave Aplicados

1. **Model Context Protocol (MCP):** 
   Estandarización de la comunicación entre fuentes de datos/herramientas (Servidor MCP) y los modelos de lenguaje (Cliente MCP) mediante transporte `stdio`.
2. **Desacoplamiento de Arquitectura:** 
   El servidor MCP funciona de forma totalmente independiente al LLM, exponiendo esquemas validados con **Zod** para sus herramientas.
3. **Descubrimiento Dinámico de Herramientas:** 
   El agente no tiene las herramientas hardcodeadas; al iniciar, consulta dinámicamente al servidor MCP qué capacidades tiene disponibles y las mapea al formato de OpenAI Tool Calling.
4. **Ejecución segura de Git:** 
   El servidor usa `execFile("git", [...args])` sin shell y separa las rutas con `--`, así un `filePath` enviado por el modelo nunca se ejecuta como comando ni se interpreta como flag (ver `src/mcp-server/git.ts` y sus tests).
5. **Bucle ReAct con Contexto Git:** 
   El agente inspecciona el estado actual de Git (`git status`) y analiza los cambios reales (`git diff`) para emitir una devolución técnica orientada a buenas prácticas y calidad de software.
6. **Git hook `pre-push` con veredicto:** 
   Antes de cada push, el agente revisa **los commits que se van a pushear** (`get_commit_log` + `get_range_diff`) y termina con `VEREDICTO: APROBADO` o `VEREDICTO: BLOQUEAR`. Si bloquea, el push se cancela. Si el revisor falla (sin API key, error de red), el push **no** se bloquea.

---

## ▶️ Uso

```bash
npm start -w 02-mcp-git-code-reviewer                          # revisa los cambios locales sin commitear
npm start -w 02-mcp-git-code-reviewer -- origin/main HEAD      # revisa los commits entre dos refs

npm run hooks:install      # activa el hook pre-push (git config core.hooksPath .githooks)
npm run hooks:uninstall    # lo desactiva
git push --no-verify       # saltea el hook una vez (o SKIP_AI_REVIEW=1 git push)
```

Cada push con el hook activo hace llamadas a la API de OpenAI.

---

## 🛠️ Stack Tecnológico y Librerías

* **Lenguaje:** TypeScript (con NodeNext y tipado estricto).
* **Protocolo de IA:** `@modelcontextprotocol/sdk` (Cliente y Servidor MCP).
* **Orquestación de IA:** [`@sandbox/agent-core`](../../packages/agent-core) (`runAgent` + `loadMcpTools`) sobre OpenAI SDK (`gpt-4o`).
* **Validación de Esquemas:** Zod.
* **Ejecución:** `tsx` para desarrollo en tiempo real.

---

## 📂 Estructura Modular del Proyecto

```text
02-mcp-git-code-reviewer/
├── src/
│   ├── agent/
│   │   ├── agent.ts          # Configura el revisor y lo corre con runAgent() de agent-core
│   │   └── verdict.ts        # Parseo del veredicto y del input del hook pre-push
│   ├── client/
│   │   └── mcpClient.ts      # Cliente MCP que gestiona la conexión con el servidor
│   ├── mcp-server/
│   │   ├── server.ts         # Servidor MCP independiente que expone herramientas de Git
│   │   └── git.ts            # Ejecución segura de git (execFile, sin shell) + tests
│   ├── prePush.ts            # Entrada del hook pre-push (../../.githooks/pre-push)
│   └── index.ts              # Punto de entrada de la aplicación
├── package.json              # Dependencias y scripts locales
└── tsconfig.json             # Configuración de TypeScript orientada al monorepo