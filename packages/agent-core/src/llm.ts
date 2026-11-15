import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { loadEnv, requireEnv } from "./env.js";

/** Modelo por defecto de los agentes; se puede cambiar con OPENAI_MODEL. */
export function defaultModel(): string {
  loadEnv();
  return process.env.OPENAI_MODEL || "gpt-4o";
}

/** Una corrida = un proceso, salvo que se indique AGENT_RUN_ID. */
const PROCESS_RUN_ID = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;

/**
 * Headers que identifican al agente ante un proxy (ver proyecto 07). Solo se
 * mandan cuando OPENAI_BASE_URL apunta a otro lado: a la API oficial no le
 * mandamos datos que no necesita.
 */
export function agentHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (!env.OPENAI_BASE_URL) return {};
  // npm define npm_package_name al correr `npm start -w <proyecto>`.
  const agentId = env.AGENT_ID || env.npm_package_name || "unknown";
  return { "x-agent-id": agentId, "x-run-id": env.AGENT_RUN_ID || `${agentId}:${PROCESS_RUN_ID}` };
}

/** Crea el cliente de OpenAI validando que la API key exista. Respeta OPENAI_BASE_URL (proxy). */
export function createOpenAI(): OpenAI {
  return new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY"), defaultHeaders: agentHeaders() });
}
