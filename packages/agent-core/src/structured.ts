import type { ChatClient } from "./agentLoop.js";
import type { JsonSchema } from "./tools.js";

export interface StructuredOptions {
  client: ChatClient;
  model: string;
  system: string;
  user: string;
  /** Nombre corto del formato (letras, números, _ o -). */
  name: string;
  /** JSON Schema estricto: todos los campos en `required` y `additionalProperties: false`. */
  schema: JsonSchema;
  temperature?: number;
}

/**
 * Pide al modelo una respuesta que cumpla un JSON Schema (structured outputs)
 * y la devuelve parseada. Sirve para que el código decida con datos, no
 * parseando texto libre.
 */
export async function generateStructured<T>({ client, model, system, user, name, schema, temperature = 0 }: StructuredOptions): Promise<T> {
  const response = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name, schema, strict: true } },
  });
  const message = response.choices[0]?.message;
  if (message?.refusal) throw new Error(`El modelo se negó a responder: ${message.refusal}`);
  if (!message?.content) throw new Error("El modelo devolvió una respuesta vacía.");
  return JSON.parse(message.content) as T;
}
