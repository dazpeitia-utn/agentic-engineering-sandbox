import { trace } from "@opentelemetry/api";
import type { ChatClient } from "./agentLoop.js";
import { ProviderUnavailableError } from "./providers.js";

type Params = Parameters<ChatClient["chat"]["completions"]["create"]>[0];

export interface RouteTarget {
  /** Nombre para logs y trazas, ej: "openai:gpt-4o-mini". */
  name: string;
  client: ChatClient;
  model: string;
}

export interface RouterOptions {
  /** Destinos en orden de preferencia para un pedido; el resto queda como fallback. */
  select: (params: Params) => RouteTarget[];
  onRoute?: (event: { target: string; requestedModel: string; attempt: number; error?: string }) => void;
}

/**
 * ¿Vale la pena probar otro proveedor? Sí ante falta de configuración, rate limit,
 * errores del servidor o de red. No ante errores del pedido (400): otro proveedor
 * probablemente falle igual y gastaríamos dos veces.
 */
export function isRetryableProviderError(error: any): boolean {
  if (error instanceof ProviderUnavailableError) return true;
  const status = error?.status;
  if (typeof status === "number") return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket/i.test(String(error?.message ?? error));
}

/**
 * Un ChatClient que elige modelo/proveedor por pedido y hace fallback.
 * El campo `model` del pedido se reemplaza por el del destino elegido.
 */
export function routedClient({ select, onRoute = () => {} }: RouterOptions): ChatClient {
  // Circuit breaker: un proveedor sin configurar (ej: sin API key) no se vuelve a probar en cada llamada.
  const unavailable = new Set<string>();
  return {
    chat: {
      completions: {
        async create(params) {
          const targets = select(params).filter((t) => !unavailable.has(t.name));
          if (!targets.length) throw new Error("El router no tiene destinos para este pedido.");
          let lastError: unknown;
          for (const [i, target] of targets.entries()) {
            try {
              const response = await target.client.chat.completions.create({ ...params, model: target.model });
              onRoute({ target: target.name, requestedModel: params.model, attempt: i + 1 });
              trace.getActiveSpan()?.setAttributes({ "router.target": target.name, "router.attempt": i + 1 });
              return response;
            } catch (error: any) {
              lastError = error;
              if (error instanceof ProviderUnavailableError) unavailable.add(target.name);
              onRoute({ target: target.name, requestedModel: params.model, attempt: i + 1, error: error?.message ?? String(error) });
              if (!isRetryableProviderError(error)) throw error;
            }
          }
          throw lastError;
        },
      },
    },
  };
}

/**
 * Política de ejemplo por tipo de tarea: los pedidos "fáciles" (salida estructurada
 * corta, sin tools) van al modelo barato; los que usan tools o tienen mucho contexto,
 * al fuerte. Siempre con el otro como fallback.
 */
export function costAwareSelect(cheap: RouteTarget[], strong: RouteTarget[], { maxCheapChars = 6000 } = {}) {
  return (params: Params): RouteTarget[] => {
    const usesTools = Array.isArray((params as any).tools) && (params as any).tools.length > 0;
    const size = JSON.stringify(params.messages).length;
    const easy = !usesTools && size <= maxCheapChars;
    return easy ? [...cheap, ...strong] : [...strong, ...cheap];
  };
}
