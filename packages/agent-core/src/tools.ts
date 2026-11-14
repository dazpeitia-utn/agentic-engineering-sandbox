import type OpenAI from "openai";

/** JSON Schema de los parámetros de una tool. */
export type JsonSchema = Record<string, unknown>;

/**
 * Una tool que el agente puede invocar. `execute` devuelve texto que vuelve al
 * modelo; si lanza un error, el loop se lo informa al modelo en vez de cortar.
 */
export interface AgentTool<Args = any> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Args): Promise<string>;
}

export function toOpenAITool(tool: AgentTool): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Exige que un argumento sea un string no vacío. */
export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`El argumento "${key}" es obligatorio y debe ser un string.`);
  }
  return value;
}
