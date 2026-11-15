/** Tipos mínimos de la API de Chat Completions que el proxy necesita inspeccionar. */

export type ContentPart = { type: string; text?: string; [key: string]: unknown };
export type MessageContent = string | ContentPart[] | null | undefined;

export interface ChatMessage {
  role: string;
  content?: MessageContent;
  [key: string]: unknown;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  response_format?: { type: string; json_schema?: { name?: string; schema?: Record<string, unknown>; strict?: boolean } };
  [key: string]: unknown;
}

export interface ChatResponse {
  choices: Array<{ index: number; message: ChatMessage & { refusal?: string | null }; [key: string]: unknown }>;
  usage?: Usage;
  [key: string]: unknown;
}

export interface EmbeddingsRequest {
  model: string;
  input: string | string[] | number[] | number[][];
  [key: string]: unknown;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Quién hace la llamada (headers x-agent-id / x-run-id). */
export interface CallContext {
  agentId: string;
  runId: string;
}

/**
 * Qué hacer con un hallazgo:
 *  - block: se corta la llamada y el agente recibe un error;
 *  - redact: el contenido se tacha y la llamada sigue;
 *  - flag: solo se registra.
 */
export type Action = "block" | "redact" | "flag";

export interface Finding {
  guard: string;
  action: Action;
  message: string;
  /** Dónde se encontró, ej: "messages[3] (tool)" o "choices[0]". Nunca el valor sensible. */
  location: string;
}
