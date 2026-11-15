/**
 * Proveedores de LLM detrás de una misma interfaz (`ChatClient`, con forma de
 * chat completions). Los agentes no saben qué proveedor usan.
 *
 *  - openai: el SDK oficial.
 *  - anthropic: adaptador a la API de Messages (traduce mensajes, tool calls y salida estructurada).
 *  - ollama (o cualquier servidor compatible con OpenAI): el mismo SDK con otra baseURL.
 */
import OpenAI from "openai";
import type { ChatClient } from "./agentLoop.js";
import { agentHeaders } from "./llm.js";
import { loadEnv } from "./env.js";

type Params = Parameters<ChatClient["chat"]["completions"]["create"]>[0];
type Completion = Awaited<ReturnType<ChatClient["chat"]["completions"]["create"]>>;

export type Provider = "openai" | "anthropic" | "ollama";

/** Error de configuración (ej: falta la API key): el router lo trata como "proveedor no disponible". */
export class ProviderUnavailableError extends Error {
  constructor(public provider: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

interface AnthropicBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p: any) => (p?.type === "text" ? p.text : "")).join("") : "";

/** Traduce un pedido en formato chat completions al formato de la API de Messages de Anthropic. */
export function toAnthropicRequest(params: Params) {
  const system = params.messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n\n");
  const messages: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]) => {
    // Anthropic exige alternar user/assistant: los mensajes seguidos del mismo rol se fusionan.
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };

  for (const m of params.messages as any[]) {
    if (m.role === "user") push("user", [{ type: "text", text: textOf(m.content) }]);
    else if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      const text = textOf(m.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.tool_calls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} });
      }
      push("assistant", blocks.length ? blocks : [{ type: "text", text: "" }]);
    } else if (m.role === "tool") push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) }]);
  }

  const request: Record<string, unknown> = {
    model: params.model,
    max_tokens: (params as any).max_tokens ?? (params as any).max_completion_tokens ?? 4096,
    messages,
    ...(system ? { system } : {}),
    ...(params.temperature !== undefined && params.temperature !== null ? { temperature: params.temperature } : {}),
  };

  const tools = ((params as any).tools ?? []).filter((t: any) => t.type === "function").map((t: any) => ({ name: t.function.name, description: t.function.description ?? "", input_schema: t.function.parameters ?? { type: "object" } }));
  const format = (params as any).response_format;
  if (format?.type === "json_schema") {
    // Salida estructurada: se fuerza una tool cuyo input ES la respuesta (patrón estándar con Anthropic).
    tools.push({ name: `respond_${format.json_schema.name}`, description: "Devuelve la respuesta final con este formato.", input_schema: format.json_schema.schema });
    request.tool_choice = { type: "tool", name: `respond_${format.json_schema.name}` };
  }
  if (tools.length) request.tools = tools;
  return { request, structuredTool: format?.type === "json_schema" ? `respond_${format.json_schema.name}` : null };
}

/** Traduce la respuesta de Anthropic a una ChatCompletion de OpenAI. */
export function fromAnthropicResponse(body: any, structuredTool: string | null): Completion {
  const blocks: AnthropicBlock[] = body.content ?? [];
  const structured = structuredTool ? blocks.find((b) => b.type === "tool_use" && b.name === structuredTool) : undefined;
  const toolUses = blocks.filter((b) => b.type === "tool_use" && b.name !== structuredTool);
  const text = structured ? JSON.stringify(structured.input) : blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  const finish = { end_turn: "stop", stop_sequence: "stop", tool_use: structured ? "stop" : "tool_calls", max_tokens: "length" }[body.stop_reason as string] ?? "stop";
  return {
    id: body.id ?? "",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "",
    choices: [
      {
        index: 0,
        finish_reason: finish,
        logprobs: null,
        message: {
          role: "assistant",
          content: text || null,
          refusal: null,
          ...(toolUses.length ? { tool_calls: toolUses.map((t) => ({ id: t.id!, type: "function", function: { name: t.name!, arguments: JSON.stringify(t.input ?? {}) } })) } : {}),
        },
      },
    ],
    usage: { prompt_tokens: body.usage?.input_tokens ?? 0, completion_tokens: body.usage?.output_tokens ?? 0, total_tokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0) },
  } as unknown as Completion;
}

export function anthropicClient({ apiKey, baseURL = "https://api.anthropic.com", fetchFn = fetch }: { apiKey?: string; baseURL?: string; fetchFn?: typeof fetch } = {}): ChatClient {
  return {
    chat: {
      completions: {
        async create(params) {
          if (!apiKey) throw new ProviderUnavailableError("anthropic", "Falta ANTHROPIC_API_KEY.");
          const { request, structuredTool } = toAnthropicRequest(params);
          const response = await fetchFn(`${baseURL.replace(/\/$/, "")}/v1/messages`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify(request),
          });
          const body: any = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error: any = new Error(`Anthropic ${response.status}: ${body?.error?.message ?? response.statusText}`);
            error.status = response.status;
            throw error;
          }
          return fromAnthropicResponse(body, structuredTool);
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fábrica por proveedor
// ---------------------------------------------------------------------------

/** Modelo por defecto según el proveedor (cada uno se puede cambiar por variable de entorno). */
export function defaultModelFor(provider: Provider): string {
  loadEnv();
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  if (provider === "ollama") return process.env.OLLAMA_MODEL || "llama3.1";
  return process.env.OPENAI_MODEL || "gpt-4o";
}

/** Cliente de chat del proveedor indicado (o de LLM_PROVIDER). Ollama usa su API compatible con OpenAI. */
export function createChatClient(provider: Provider = (process.env.LLM_PROVIDER as Provider) || "openai"): ChatClient {
  loadEnv();
  if (provider === "anthropic") return anthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
  if (provider === "ollama") return new OpenAI({ apiKey: "ollama", baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1" });
  if (provider !== "openai") throw new Error(`Proveedor desconocido: ${provider}. Opciones: openai, anthropic, ollama.`);
  if (!process.env.OPENAI_API_KEY) throw new ProviderUnavailableError("openai", "Falta OPENAI_API_KEY.");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, defaultHeaders: agentHeaders() });
}

/**
 * Cliente + modelo según LLM_PROVIDER: openai (default), anthropic, ollama o router.
 * "router" elige por tipo de pedido (costAwareSelect) con fallback entre proveedores:
 * pedidos simples → gpt-4o-mini (o Claude Haiku); con tools o mucho contexto → Claude Sonnet (o gpt-4o).
 */
export async function createLLM(provider: string = process.env.LLM_PROVIDER || "openai"): Promise<{ client: ChatClient; model: string; provider: string }> {
  loadEnv();
  if (provider !== "router") return { client: createChatClient(provider as Provider), model: defaultModelFor(provider as Provider), provider };
  const { routedClient, costAwareSelect } = await import("./router.js");
  const target = (p: Provider, model: string) => ({ name: `${p}:${model}`, model, get client() { return createChatClient(p); } });
  const cheap = [target("openai", "gpt-4o-mini"), target("anthropic", process.env.ANTHROPIC_CHEAP_MODEL || "claude-haiku-5-5")];
  const strong = [target("anthropic", defaultModelFor("anthropic")), target("openai", "gpt-4o")];
  const client = routedClient({
    select: costAwareSelect(cheap, strong),
    onRoute: (e) => {
      if (e.error) console.warn(`↪️  router: ${e.target} falló (${e.error.slice(0, 80)}); pruebo el siguiente`);
      else if (process.env.ROUTER_VERBOSE) console.log(`🧭 router: ${e.target}`);
    },
  });
  return { client, model: "router", provider };
}
