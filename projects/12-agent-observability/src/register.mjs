/**
 * Preload de tracing: registra el SDK de OpenTelemetry ANTES de que arranque la app.
 * Instrumenta cualquier proyecto del monorepo sin tocar su código:
 *
 *   NODE_OPTIONS="--import $PWD/projects/12-agent-observability/src/register.mjs" npm start -w 04-autonomous-bug-fixer
 *
 * Está en JavaScript plano (no TypeScript) porque corre antes de que se cargue tsx.
 *
 * Exporta a:
 *  - un archivo JSONL por servicio en projects/12-agent-observability/traces/ (siempre; no necesita infraestructura);
 *  - OTLP/HTTP (Jaeger, Langfuse, Tempo...) si está definida OTEL_EXPORTER_OTLP_ENDPOINT.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { serializeSpan } from "./serialize.mjs";

const TRACES_DIR = process.env.AGENT_TRACES_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../traces");
const serviceName = process.env.AGENT_ID || process.env.OTEL_SERVICE_NAME || process.env.npm_package_name || "agent";

/**
 * Exporter a JSONL con escritura síncrona: aunque la app termine con process.exit(),
 * los spans ya están en disco (con un exporter en lote se perderían).
 */
class JsonlFileExporter {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  export(spans, done) {
    try {
      fs.appendFileSync(this.file, spans.map((s) => JSON.stringify(serializeSpan(s, serviceName))).join("\n") + "\n");
      done({ code: 0 });
    } catch (error) {
      done({ code: 1, error });
    }
  }
  async shutdown() {}
  async forceFlush() {}
}

const processors = [new SimpleSpanProcessor({ exporter: new JsonlFileExporter(path.join(TRACES_DIR, `${serviceName}-${new Date().toISOString().slice(0, 10)}.jsonl`)) })];

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  processors.push(new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }));
}

const provider = new TracerProvider({ resource: resourceFromAttributes({ "service.name": serviceName }), spanProcessors: processors });
// El context manager con AsyncLocalStorage hace que los spans se aniden solos a través de los await.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);

const flush = () => provider.shutdown().catch(() => {});
process.once("beforeExit", flush);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => flush().then(() => process.exit(0)));
