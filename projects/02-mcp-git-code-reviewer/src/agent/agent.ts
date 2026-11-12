import OpenAI from "openai";
import { GitMcpClient } from "../client/mcpClient.js";

export async function runGitReviewerAgent() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const mcpClient = new GitMcpClient();
  await mcpClient.connect();

  try {
    const mcpTools = await mcpClient.listAvailableTools();
    console.log(`🛠️ [Agente] Herramientas descubiertas vía MCP:`, mcpTools.map((t) => t.name));

    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = mcpTools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "Eres un Ingeniero de Software Senior experto en Code Review. Tu objetivo es revisar los cambios actuales de Git en el repositorio del usuario. " +
          "Primero verifica el estado con 'get_git_status' y luego obtén los cambios con 'get_git_diff'. " +
          "Analiza el código modificado buscando malas prácticas, errores de tipos, bugs potenciales o mejoras de rendimiento, y da una devolución técnica constructiva y profesional.",
      },
      {
        role: "user",
        content: "Por favor, revisa el estado actual de Git y haz una code review completa de los cambios pendientes.",
      },
    ];

    console.log("🤖 [Agente] Iniciando análisis de cambios en Git...");

    let continueLoop = true;
    while (continueLoop) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools: openaiTools,
        tool_choice: "auto",
      });

      const responseMessage = response.choices[0].message;
      messages.push(responseMessage);

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== "function") continue;

          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

          console.log(`\n🔧 [Tool Call ejecutada vía MCP] ${toolName}`, toolArgs);

          const mcpResult: any = await mcpClient.callTool(toolName, toolArgs);

          const toolOutputText = mcpResult.content
            ? mcpResult.content.map((c: any) => c.text).join("\n")
            : JSON.stringify(mcpResult);

          console.log(`📥 [Resultado de MCP]:`, toolOutputText.slice(0, 200) + (toolOutputText.length > 200 ? "..." : ""));

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutputText,
          });
        }
      } else {
        continueLoop = false;
        console.log(`\n✨ Code Review Final del Agente MCP:\n`);
        console.log(responseMessage.content);
      }
    }
  } finally {
    await mcpClient.disconnect();
  }
}