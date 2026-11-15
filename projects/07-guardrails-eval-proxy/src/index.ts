import { createDeps, loadConfig } from "./config.js";
import { createProxyServer } from "./server.js";

const config = loadConfig();
const server = createProxyServer(createDeps(config), { token: config.token });

server.listen(config.port, config.host, () => {
  console.log(`🛡️ Guardrails proxy escuchando en http://${config.host}:${config.port}/v1`);
  console.log(`   Upstream: ${config.upstreamURL}`);
  console.log(`   Presupuesto: US$${config.maxUsdPerRun} por corrida, US$${config.maxUsdPerAgent} por agente · ${config.maxRequestsPerMinute} req/min`);
  console.log(`   Clasificador LLM de injection: ${config.llmClassifier ? `sí (${config.classifierModel})` : "no"} · Logs: ${config.logDir}`);
  console.log(`\n   Para usarlo: OPENAI_BASE_URL=http://${config.host}:${config.port}/v1 npm start -w <proyecto>`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
