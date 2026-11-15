/**
 * Instrumentación con OpenTelemetry. agent-core depende SOLO de @opentelemetry/api:
 * si ninguna app registró un SDK, los spans son no-op y no cuestan nada. El
 * proyecto 12 registra el SDK (preload `--import`) y exporta las trazas.
 *
 * Nombres y atributos siguen las convenciones semánticas GenAI de OpenTelemetry
 * (gen_ai.operation.name, gen_ai.request.model, gen_ai.usage.*, gen_ai.tool.name).
 */
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

export const tracer = trace.getTracer("@sandbox/agent-core", "1.0.0");

/** Corre `fn` dentro de un span activo: los spans que se creen adentro quedan como hijos. */
export async function withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      // Sin setStatus(OK): por convención el éxito queda UNSET, y así no se pisa un
      // ERROR que haya marcado el propio código (ej: una tool que devolvió un error).
      return await fn(span);
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message ?? String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Atributos de una respuesta de chat completions (tokens, finish reason). */
export function chatResponseAttributes(response: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; choices?: Array<{ finish_reason?: string | null }> }): Attributes {
  return {
    "gen_ai.response.model": response.model ?? "",
    "gen_ai.usage.input_tokens": response.usage?.prompt_tokens ?? 0,
    "gen_ai.usage.output_tokens": response.usage?.completion_tokens ?? 0,
    "gen_ai.response.finish_reasons": (response.choices ?? []).map((c) => c.finish_reason ?? "unknown"),
  };
}
