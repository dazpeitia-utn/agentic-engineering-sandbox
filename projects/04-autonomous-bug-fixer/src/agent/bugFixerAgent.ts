import OpenAI from "openai";
import { readFileTool, writeFileTool } from "../tools.js";

export async function runBugFixerAgent(bugReport: string) {
  // Instanciamos OpenAI aquí adentro para asegurar que process.env.OPENAI_API_KEY ya esté cargado
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "Eres un Ingeniero de Software Agente Autónomo experto en depuración de código en TypeScript. " +
        "Tu objetivo es resolver el error reportado utilizando las herramientas disponibles:\n" +
        "1. Lee el archivo afectado (por ejemplo, 'src/buggyCode.ts') usando la herramienta de lectura.\n" +
        "2. Analiza el error lógicamente.\n" +
        "3. Utiliza la herramienta de escritura para aplicar el parche correcto al archivo.\n" +
        "Sé preciso y verifica tu solución antes de terminar.",
    },
    {
      role: "user",
      content: `Reporte de error / Test fallido:\n${bugReport}`,
    },
  ];

  // Definimos las herramientas que OpenAI puede invocar
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "readFileTool",
        description: "Lee el contenido de un archivo de código fuente.",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Ruta relativa del archivo, ej: src/buggyCode.ts" },
          },
          required: ["filePath"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "writeFileTool",
        description: "Escribe el código corregido (parche completo) en el archivo.",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Ruta relativa del archivo, ej: src/buggyCode.ts" },
            content: { type: "string", description: "El código completo corregido que reemplazará al anterior." },
          },
          required: ["filePath", "content"],
        },
      },
    },
  ];

  console.log("🤖 [Bug Fixer Agent] Iniciando análisis del error...");

  let working = true;
  let finalAnswer = "";

  while (working) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
    });

    const responseMessage = response.choices[0].message;
    messages.push(responseMessage);

    if (responseMessage.tool_calls) {
      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type !== "function") continue;
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log(`🔧 [Tool Call] El agente ejecutó: ${functionName}`, functionArgs);

        let toolResult = "";
        if (functionName === "readFileTool") {
          toolResult = await readFileTool(functionArgs.filePath);
        } else if (functionName === "writeFileTool") {
          toolResult = await writeFileTool(functionArgs.filePath, functionArgs.content);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
    } else {
      working = false;
      finalAnswer = responseMessage.content || "Proceso de corrección finalizado.";
    }
  }

  return finalAnswer;
}