/** Serialización de spans a JSON simple. Sin efectos secundarios: se puede importar en tests. */
const hrToMs = ([s, ns]) => s * 1000 + ns / 1e6;

/** Convierte un span del SDK en una línea JSON simple (lo que lee el visor). */
export function serializeSpan(span, fallbackService = "agent") {
  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    name: span.name,
    service: span.resource?.attributes?.["service.name"] ?? fallbackService,
    startMs: hrToMs(span.startTime),
    endMs: hrToMs(span.endTime),
    status: span.status?.code === 2 ? "error" : "ok",
    statusMessage: span.status?.message ?? "",
    attributes: span.attributes,
    events: span.events.map((e) => ({ name: e.name, timeMs: hrToMs(e.time), attributes: e.attributes ?? {} })),
  };
}
