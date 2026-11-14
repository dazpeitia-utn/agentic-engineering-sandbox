# 🤖 Proyecto 04: Autonomous Bug Fixer

Agente autónomo de ingeniería de software desarrollado en TypeScript y impulsado por **GPT-4o (Tool Calling)**, diseñado para detectar errores en código fuente, analizar archivos, y aplicar parches de corrección de forma totalmente automática.

---

## 🏗️ Arquitectura del Sistema

El sistema implementa un loop de razonamiento agéntico cerrado (*Agentic Loop*):

1. **Definición del Bug (`src/buggyCode.ts` + `src/buggyCode.test.ts`):** Código con un error lógico intencional y un test real que lo detecta. El test falla a propósito, por eso está excluido del `npm test` de la raíz.
2. **Herramientas ([`agent-core`](../../packages/agent-core)):** `read_file` / `write_file` limitadas a la carpeta del proyecto (sin permiso para modificar tests) y `run_tests` para ejecutar Vitest.
3. **Motor del Agente (`src/agent/bugFixerAgent.ts`):** 
   - Configura un prompt de sistema especializado en depuración en TypeScript.
   - Corre el loop ReAct compartido (`runAgent` de agent-core): procesa la respuesta del LLM, ejecuta las `tool_calls` y devuelve los resultados al modelo hasta que termina, con un máximo de 8 iteraciones.
4. **Flujo completo:**
   - **Captura:** corre el test y le pasa al agente la salida real de Vitest (assertion + stack trace), no un reporte escrito a mano.
   - **Aislamiento y parche:** el agente ubica el archivo y la línea en el stack trace, lo lee y aplica el parche.
   - **Validación:** el agente corre `run_tests`, y al final el programa vuelve a correr los tests por su cuenta; sale con código 1 si siguen fallando.

## ▶️ Uso

```bash
npm start -w 04-autonomous-bug-fixer   # captura el fallo, parchea y valida
npm run reset -w 04-autonomous-bug-fixer   # restaura el bug de demo para volver a probar
```