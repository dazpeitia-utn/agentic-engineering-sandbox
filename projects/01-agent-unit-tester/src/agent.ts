import OpenAI from 'openai';
import { SYSTEM_PROMPT, TOOLS_DEFINITION } from './prompt.js';
import { readFileTool, writeFileTool } from './tools.js';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI();

export async function runAgent(userGoal: string) {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userGoal }
  ];

  console.log(`🤖 Agente iniciado con objetivo: "${userGoal}"\n`);

  // Bucle del agente (ReAct loop)
  while (true) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      tools: TOOLS_DEFINITION as any,
    });

    const message = response.choices[0].message;
    messages.push(message);

    // Si el LLM decide llamar a una herramienta
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const rawToolCall of message.tool_calls) {
        // Hacemos el cast a any para evitar el conflicto de tipos de la SDK de OpenAI
        const toolCall = rawToolCall as any;
        
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log(`🔧 [Tool Call] Ejecutando: ${functionName}`, functionArgs);

        let toolResult = "";
        try {
          if (functionName === "read_file") {
            toolResult = await readFileTool(functionArgs.filePath);
          } else if (functionName === "write_file") {
            toolResult = await writeFileTool(functionArgs.filePath, functionArgs.content);
          }
        } catch (error: any) {
          toolResult = `Error ejecutando herramienta: ${error.message}`;
        }

        // Devolvemos el resultado de la herramienta al LLM
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
    }else {
      // Si el LLM ya respondió con texto final y no requiere más herramientas
      console.log("\n✨ Respuesta final del Agente:");
      console.log(message.content);
      break;
    }
  }
}
