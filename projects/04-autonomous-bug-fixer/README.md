# 🤖 Proyecto 04: Autonomous Bug Fixer

Agente autónomo de ingeniería de software desarrollado en TypeScript y impulsado por **GPT-4o (Tool Calling)**, diseñado para detectar errores en código fuente, analizar archivos, y aplicar parches de corrección de forma totalmente automática.

---

## 🏗️ Arquitectura del Sistema

El sistema implementa un loop de razonamiento agéntico cerrado (*Agentic Loop*):

1. **Definición del Bug (`src/buggyCode.ts`):** Contiene código con un error lógico intencional (por ejemplo, una operación matemática incorrecta) para evaluar la capacidad de depuración del agente.
2. **Herramientas de Sistema / MCP (`src/tools.ts`):** Exponen funciones de lectura (`readFileTool`) y escritura (`writeFileTool`) en el sistema de archivos local para que el agente interactúe directamente con el código.
3. **Motor del Agente (`src/agent/bugFixerAgent.ts`):** 
   - Configura un prompt de sistema especializado en depuración en TypeScript.
   - Ejecuta un ciclo iterativo (*while loop*) donde procesa la respuesta del LLM, detecta si requiere invocar herramientas (`tool_calls`), ejecuta dichas herramientas en local, y devuelve los resultados al modelo hasta que la tarea se completa con éxito.
4. **Punto de Entrada (`src/index.ts`):** Inyecta el reporte de error inicial y dispara el proceso del agente.