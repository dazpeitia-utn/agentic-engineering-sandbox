import { consoleLogger, createOpenAI, defaultModel, loadMcpTools, runAgent } from "@sandbox/agent-core";
import { GitMcpClient } from "../client/mcpClient.js";

const SYSTEM_PROMPT =
  "Eres un Ingeniero de Software Senior experto en Code Review. Tu objetivo es revisar los cambios actuales de Git en el repositorio del usuario. " +
  "Primero verifica el estado con 'get_git_status' y luego obtén los cambios con 'get_git_diff'. " +
  "Analiza el código modificado buscando malas prácticas, errores de tipos, bugs potenciales o mejoras de rendimiento, y da una devolución técnica constructiva y profesional.";

export async function runGitReviewerAgent(): Promise<string | null> {
  const mcpClient = new GitMcpClient();
  await mcpClient.connect();

  try {
    // Descubrimiento dinámico: las tools vienen del servidor MCP, no están hardcodeadas acá.
    const tools = await loadMcpTools(mcpClient.sdk);
    console.log(`🛠️ [Agente] Herramientas descubiertas vía MCP:`, tools.map((t) => t.name));
    console.log("🤖 [Agente] Iniciando análisis de cambios en Git...");

    const result = await runAgent({
      client: createOpenAI(),
      model: defaultModel(),
      system: SYSTEM_PROMPT,
      user: "Por favor, revisa el estado actual de Git y haz una code review completa de los cambios pendientes.",
      tools,
      maxIterations: 8,
      onEvent: consoleLogger("🔍"),
    });

    if (result.stoppedReason === "max_iterations") {
      console.warn(`⚠️ El agente no terminó en ${result.iterations} iteraciones.`);
      return null;
    }
    console.log(`\n✨ Code Review Final del Agente MCP:\n`);
    console.log(result.finalText);
    return result.finalText;
  } finally {
    await mcpClient.disconnect();
  }
}
