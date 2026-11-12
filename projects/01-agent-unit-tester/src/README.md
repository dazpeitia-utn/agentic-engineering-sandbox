# 01 - Autonomous Unit Tester Agent (Agente Generador de Tests Unitarios)

Un agente autónomo desarrollado en **TypeScript** que utiliza el bucle de ejecución **ReAct (Reasoning and Acting)** y **Tool Calling** para analizar código fuente local y generar automáticamente pruebas unitarias robustas utilizando **Vitest**.

---

## 🧠 Conceptos Clave Aplicados

1. **Bucle de Ejecución ReAct (ReAct Loop):** 
   El agente no se limita a responder en un solo turno; opera bajo un ciclo iterativo donde *razona* el objetivo, decide qué *acción* tomar, ejecuta la herramienta correspondiente y *observa* el resultado para decidir el siguiente paso.
2. **Tool Calling (Llamada a Herramientas):** 
   Se exponen funciones locales (`read_file`, `write_file`) al modelo de lenguaje (LLM) formateadas mediante esquemas de tipo JSON, permitiendo que la IA interactúe directamente con el sistema de archivos de forma controlada.
3. **Prompt Engineering Estructurado:** 
   Separación de responsabilidades entre el `system prompt` (definición de la personalidad, rol y restricciones del agente) y la definición técnica de las herramientas disponibles.

---

## 🛠️ Stack Tecnológico y Librerías

* **Lenguaje:** TypeScript (con configuración estricta en NodeNext).
* **Orquestación de IA:** OpenAI SDK (`gpt-4o`).
* **Ejecución en Tiempo de Real:** `tsx` para correr TypeScript directamente sin compilación previa manual.
* **Entorno:** Manejo de variables de entorno con `dotenv`.
* **Framework de Testing Objetivo:** Vitest / Jest.

---

## 📂 Estructura del Proyecto

```text
01-agent-unit-tester/
├── src/
│   ├── agent.ts         # Contiene la implementación del bucle ReAct y el orquestador con OpenAI
│   ├── tools.ts         # Implementación de las funciones de lectura y escritura de archivos locales
│   ├── prompt.ts        # System prompts y esquemas JSON Schema de las herramientas
│   ├── math.ts          # Código fuente de ejemplo a probar
│   └── index.ts         # Punto de entrada para ejecutar el agente
├── .env                 # Variables de entorno (OPENAI_API_KEY)
├── package.json         # Dependencias locales del proyecto
└── tsconfig.json        # Configuración de TypeScript