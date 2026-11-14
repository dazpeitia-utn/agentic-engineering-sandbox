# 🤖 Proyecto 04: Autonomous Bug Fixer

Agente autónomo de ingeniería de software desarrollado en TypeScript y impulsado por **GPT-4o (Tool Calling)**, diseñado para detectar errores en código fuente, analizar archivos, y aplicar parches de corrección de forma totalmente automática.

---

## 🏗️ Arquitectura del Sistema

El sistema implementa un loop de razonamiento agéntico cerrado (*Agentic Loop*):

1. **Definición del Bug (`src/buggyCode.ts`):** Contiene código con un error lógico intencional (por ejemplo, una operación matemática incorrecta) para evaluar la capacidad de depuración del agente.
2. **Herramientas de archivos (`createFsTools` de [`agent-core`](../../packages/agent-core)):** `read_file` y `write_file`, limitadas a la carpeta del proyecto: el agente no puede leer ni escribir fuera de ella.
3. **Motor del Agente (`src/agent/bugFixerAgent.ts`):** 
   - Configura un prompt de sistema especializado en depuración en TypeScript.
   - Corre el loop ReAct compartido (`runAgent` de agent-core): procesa la respuesta del LLM, ejecuta las `tool_calls` y devuelve los resultados al modelo hasta que termina, con un máximo de 8 iteraciones.
4. **Punto de Entrada (`src/index.ts`):** Inyecta el reporte de error inicial y dispara el proceso del agente.