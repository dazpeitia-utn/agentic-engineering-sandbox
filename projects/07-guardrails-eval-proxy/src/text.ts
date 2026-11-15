import type { ChatMessage, MessageContent } from "./types.js";

/** Aplica `fn` a cada texto de un contenido (string o lista de partes) y devuelve el contenido nuevo. */
export function mapContentText(content: MessageContent, fn: (text: string) => string): MessageContent {
  if (typeof content === "string") return fn(content);
  if (Array.isArray(content)) {
    return content.map((part) => (part.type === "text" && typeof part.text === "string" ? { ...part, text: fn(part.text) } : part));
  }
  return content;
}

/** Todo el texto de un contenido, concatenado. */
export function contentText(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : "")).join("\n");
  return "";
}

export const describeMessage = (message: ChatMessage, index: number) => `messages[${index}] (${message.role})`;

/** Normaliza para comparar patrones: minúsculas, sin acentos y con espacios simples. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}
