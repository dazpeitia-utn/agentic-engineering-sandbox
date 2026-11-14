# 01 - Autonomous Unit Tester Agent (Agente Generador de Tests Unitarios)

Un agente autónomo desarrollado en **TypeScript** que utiliza el bucle de ejecución **ReAct (Reasoning and Acting)** y **Tool Calling** para analizar código fuente local y generar automáticamente pruebas unitarias robustas utilizando **Vitest**.

---

## 🧠 Conceptos Clave Aplicados

1. **Bucle de Ejecución ReAct (ReAct Loop):** 
   El agente no se limita a responder en un solo turno; opera bajo un ciclo iterativo donde *razona* el objetivo, decide qué *acción* tomar, ejecuta la herramienta correspondiente y *observa* el resultado para decidir el siguiente paso.
2. **Tool Calling (Llamada a Herramientas):** 
   Se exponen funciones locales (`read_file`, `write_file`) al modelo de lenguaje (LLM) formateadas mediante esquemas de tipo JSON, permitiendo que la IA interactúe directamente con el sistema de archivos de forma controlada.
3. **Loop de feedback con ejecución real:** 
   El agente no solo escribe los tests: los ejecuta con la tool `run_tests` (Vitest), lee la salida y los corrige hasta que pasan. Solo puede escribir archivos `*.test.ts`, así que no puede "arreglar" el código fuente para que los tests pasen. Al final, el programa vuelve a correr los tests por su cuenta y sale con código 1 si fallan.
4. **Prompt Engineering Estructurado:** 
   Separación de responsabilidades entre el `system prompt` (definición de la personalidad, rol y restricciones del agente) y la definición técnica de las herramientas disponibles.

---

## 🛠️ Stack Tecnológico y Librerías

* **Lenguaje:** TypeScript (con configuración estricta en NodeNext).
* **Orquestación de IA:** [`@sandbox/agent-core`](../../packages/agent-core) (loop ReAct + tools de archivos) sobre OpenAI SDK (`gpt-4o`).
* **Ejecución en Tiempo de Real:** `tsx` para correr TypeScript directamente sin compilación previa manual.
* **Entorno:** `.env` único en la raíz del monorepo, cargado por `agent-core`.
* **Framework de Testing Objetivo:** Vitest / Jest.

---

## ▶️ Uso

```bash
npm start -w 01-agent-unit-tester                                # genera src/math.test.ts para src/math.ts
npm start -w 01-agent-unit-tester -- src/otro.ts src/otro.test.ts
```

---

## 📂 Estructura del Proyecto

```text
01-agent-unit-tester/
├── src/
│   ├── agent.ts         # Configura el agente y lo corre con runAgent() de agent-core
│   ├── prompt.ts        # System prompt del agente
│   ├── math.ts          # Código fuente de ejemplo a probar
│   └── index.ts         # Punto de entrada para ejecutar el agente
├── package.json         # Dependencias locales del proyecto
└── tsconfig.json        # Configuración de TypeScript