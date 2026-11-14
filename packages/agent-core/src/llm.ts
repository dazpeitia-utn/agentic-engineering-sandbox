import OpenAI from "openai";
import { loadEnv, requireEnv } from "./env.js";

/** Modelo por defecto de los agentes; se puede cambiar con OPENAI_MODEL. */
export function defaultModel(): string {
  loadEnv();
  return process.env.OPENAI_MODEL || "gpt-4o";
}

/** Crea el cliente de OpenAI validando que la API key exista. */
export function createOpenAI(): OpenAI {
  return new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
}
