/**
 * Levanta los tres agentes A2A, cada uno en su propio proceso (servicios separados).
 *
 *   npm run agents -w 17-agent-to-agent-a2a            # los tres
 *   npm run agents -w 17-agent-to-agent-a2a -- docs    # uno solo, en este proceso
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createAgentApp, listen } from "./a2a.js";
import { AGENTS } from "./agents.js";

const name = process.argv[2];

if (name) {
  const entry = AGENTS[name];
  if (!entry) throw new Error(`Agente desconocido "${name}". Disponibles: ${Object.keys(AGENTS).join(", ")}`);
  const url = `http://127.0.0.1:${entry.port}`;
  const { app, card } = createAgentApp(entry.def, url, { token: process.env.A2A_TOKEN });
  await listen(app, entry.port);
  console.log(`🤖 ${card.name} en ${url} · Agent Card: ${url}/.well-known/agent-card.json`);
} else {
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  // Cada servicio se identifica con su nombre ante el proxy (07): presupuesto y políticas por agente.
  const children = Object.entries(AGENTS).map(([agent, { def }]) =>
    spawn(process.execPath, [tsx, fileURLToPath(import.meta.url), agent], { stdio: "inherit", env: { ...process.env, AGENT_ID: def.name } }),
  );
  const stop = () => children.forEach((c) => c.kill("SIGTERM"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
