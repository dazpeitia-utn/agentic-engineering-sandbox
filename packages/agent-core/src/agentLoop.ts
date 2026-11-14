import type OpenAI from "openai";
import { toOpenAITool, type AgentTool } from "./tools.js";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Lo mínimo que el loop necesita del cliente (permite inyectar un fake en tests). */
export interface ChatClient {
  chat: {
    completions: {
      create(params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.Completions.ChatCompletion>;
    };
  };
}

export type AgentEvent =
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; output: string; isError: boolean }
  | { type: "final"; content: string };

export interface RunAgentOptions {
  client: ChatClient;
  model: string;
  system: string;
  user: string;
  tools?: AgentTool[];
  /** Cantidad máxima de llamadas al modelo antes de cortar (default 10). */
  maxIterations?: number;
  /** Largo máximo del resultado de una tool que se le devuelve al modelo. */
  maxToolOutputChars?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  /** Respuesta final del modelo, o null si se cortó por maxIterations. */
  finalText: string | null;
  stoppedReason: "completed" | "max_iterations";
  iterations: number;
  messages: Message[];
}

/**
 * Loop ReAct: llama al modelo, ejecuta las tools que pida y le devuelve los
 * resultados, hasta que responda sin tools o se llegue a `maxIterations`.
 */
export async function runAgent({
  client,
  model,
  system,
  user,
  tools = [],
  maxIterations = 10,
  maxToolOutputChars = 50_000,
  onEvent = () => {},
}: RunAgentOptions): Promise<AgentResult> {
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const messages: Message[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      ...(tools.length > 0 ? { tools: tools.map(toOpenAITool), tool_choice: "auto" as const } : {}),
    });

    const message = response.choices[0]?.message;
    if (!message) throw new Error("El modelo devolvió una respuesta vacía.");
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const content = message.content ?? "";
      onEvent({ type: "final", content });
      return { finalText: content, stoppedReason: "completed", iterations: iteration, messages };
    }

    for (const toolCall of message.tool_calls) {
      const output = toolCall.type === "function"
        ? await executeToolCall(toolsByName, toolCall.function.name, toolCall.function.arguments, onEvent)
        : "Error: solo se admiten tools de tipo function.";
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: truncate(output, maxToolOutputChars) });
    }
  }

  return { finalText: null, stoppedReason: "max_iterations", iterations: maxIterations, messages };
}

async function executeToolCall(
  toolsByName: Map<string, AgentTool>,
  name: string,
  rawArgs: string,
  onEvent: (event: AgentEvent) => void,
): Promise<string> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return report(name, "Error: los argumentos no son JSON válido. Reintentá con JSON válido.", true);
  }
  onEvent({ type: "tool_call", name, args });

  const tool = toolsByName.get(name);
  if (!tool) return report(name, `Error: la tool "${name}" no existe.`, true);
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return report(name, "Error: los argumentos deben ser un objeto JSON.", true);
  }

  try {
    return report(name, await tool.execute(args), false);
  } catch (error: any) {
    return report(name, `Error ejecutando ${name}: ${error?.message ?? String(error)}`, true);
  }

  function report(toolName: string, output: string, isError: boolean): string {
    onEvent({ type: "tool_result", name: toolName, output, isError });
    return output;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncado: ${text.length - max} caracteres más]`;
}

/** Logger por consola reutilizable para los eventos del loop. */
export function consoleLogger(prefix = "🤖"): (event: AgentEvent) => void {
  return (event) => {
    if (event.type === "tool_call") console.log(`${prefix} 🔧 ${event.name}`, event.args);
    if (event.type === "tool_result") {
      const preview = event.output.length > 200 ? `${event.output.slice(0, 200)}...` : event.output;
      console.log(`${prefix} ${event.isError ? "⚠️" : "📥"} ${event.name}: ${preview}`);
    }
  };
}
