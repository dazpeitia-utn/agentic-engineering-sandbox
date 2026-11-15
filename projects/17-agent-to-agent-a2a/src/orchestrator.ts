/**
 * Orquestador A2A: no conoce a los agentes de antemano. Lee sus Agent Cards,
 * decide con el LLM a quién delegar qué, les manda las tareas en paralelo
 * (returnImmediately), consulta su estado hasta que terminan y sintetiza.
 *
 *   npm run orchestrate -w 17-agent-to-agent-a2a -- "tarea"
 */
import { pathToFileURL } from "node:url";
import { ClientFactory, ClientFactoryOptions, type CallInterceptor, type Client } from "@a2a-js/sdk/client";
import { TaskState, type AgentCard, type Task } from "@a2a-js/sdk";
import { createOpenAI, defaultModel, generateStructured, type ChatClient } from "@sandbox/agent-core";
import { partsText, userMessage } from "./a2a.js";

export interface ConnectedAgent {
  url: string;
  card: AgentCard;
  client: Client;
  run(text: string, onStatus?: (t: TaskOutcome) => void): Promise<TaskOutcome>;
}

export interface TaskOutcome {
  id: string;
  state: TaskState;
  output: string;
  statusText: string;
}

const TERMINAL = new Set([TaskState.TASK_STATE_COMPLETED, TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_REJECTED]);

const outcome = (task: Task): TaskOutcome => ({
  id: task.id,
  state: task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED,
  output: task.artifacts.map((a) => partsText(a.parts)).join("\n"),
  statusText: partsText(task.status?.message?.parts),
});

/** Descubre un agente por su Agent Card (en /.well-known/agent-card.json) con el cliente oficial. */
export async function connectAgent(url: string, token?: string): Promise<ConnectedAgent> {
  // El token va como header en cada llamada, con un interceptor del cliente oficial.
  // (La Agent Card es pública: el descubrimiento no necesita token.)
  const authInterceptor: CallInterceptor = {
    async before(args) {
      args.options = { ...args.options, serviceParameters: { ...args.options?.serviceParameters, authorization: `Bearer ${token}` } };
    },
    async after() {},
  };
  const options = token ? ClientFactoryOptions.createFrom(ClientFactoryOptions.default, { clientConfig: { interceptors: [authInterceptor] } }) : ClientFactoryOptions.default;
  const client = await new ClientFactory(options).createFromUrl(url);
  const card = await client.getAgentCard();
  const agent: ConnectedAgent = {
    url,
    card,
    client,
    async run(text, onStatus) {
      const result: any = await client.sendMessage({
        tenant: "",
        message: userMessage(text),
        configuration: { acceptedOutputModes: ["text/plain"], taskPushNotificationConfig: undefined, returnImmediately: true },
        metadata: undefined,
      });
      const id = result?.id ?? result?.task?.id;
      if (!id) return { id: "", state: TaskState.TASK_STATE_COMPLETED, output: partsText(result?.parts ?? result?.message?.parts), statusText: "" };
      return waitForTask(agent, id, { onStatus });
    },
  };
  return agent;
}

/** Consulta la tarea (tasks/get) hasta que llegue a un estado terminal. */
export async function waitForTask(agent: Pick<ConnectedAgent, "client">, id: string, { intervalMs = 1000, timeoutMs = 300_000, onStatus }: { intervalMs?: number; timeoutMs?: number; onStatus?: (t: TaskOutcome) => void } = {}): Promise<TaskOutcome> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (true) {
    const task = outcome(await agent.client.getTask({ tenant: "", id }));
    const key = `${task.state}:${task.statusText}`;
    if (key !== last) onStatus?.(task);
    last = key;
    if (TERMINAL.has(task.state)) return task;
    if (Date.now() > deadline) throw new Error(`La tarea ${id} no terminó en ${timeoutMs / 1000}s.`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface OrchestrationResult {
  agents: ConnectedAgent[];
  plan: { delegations: Array<{ agent: string; message: string }>; reasoning: string };
  results: Array<{ agent: string; message: string } & TaskOutcome>;
  skipped: string[];
  answer: string;
}

export async function orchestrate(
  task: string,
  urls: string[],
  { client, model, token, onEvent = () => {} }: { client: ChatClient; model: string; token?: string; onEvent?: (e: string) => void },
): Promise<OrchestrationResult> {
  // 1. Descubrimiento: solo sabemos URLs; lo que hace cada agente lo dice su Agent Card.
  const agents = await Promise.all(urls.map((u) => connectAgent(u, token)));
  for (const a of agents) onEvent(`🪪 ${a.card.name}: ${a.card.description} (skills: ${a.card.skills.map((s) => s.name).join(", ")})`);
  const directory = agents
    .map((a) => `- ${a.card.name}: ${a.card.description}\n  Skills:\n${a.card.skills.map((s) => `    · ${s.name}: ${s.description}${s.examples.length ? ` (ej: ${s.examples.join(" | ")})` : ""}`).join("\n")}`)
    .join("\n");

  // 2. Plan: a quién delegar qué.
  const plan = await generateStructured<OrchestrationResult["plan"]>({
    client,
    model,
    name: "delegation_plan",
    schema: {
      type: "object",
      properties: {
        reasoning: { type: "string" },
        delegations: {
          type: "array",
          items: { type: "object", properties: { agent: { type: "string" }, message: { type: "string" } }, required: ["agent", "message"], additionalProperties: false },
        },
      },
      required: ["reasoning", "delegations"],
      additionalProperties: false,
    },
    system:
      "Eres un orquestador. Tienes un directorio de agentes remotos (Agent Cards). Divide la tarea en pedidos para los agentes adecuados. " +
      "Cada mensaje debe ser autocontenido: el agente no ve la tarea original. Usa solo agentes del directorio y solo los necesarios.",
    user: `Directorio de agentes:\n${directory}\n\nTarea: ${task}`,
  });
  onEvent(`🧭 Plan: ${plan.reasoning}`);

  // 3. Delegación en paralelo (cada agente es un servicio independiente).
  const byName = new Map(agents.map((a) => [a.card.name, a]));
  const skipped = plan.delegations.filter((d) => !byName.has(d.agent)).map((d) => d.agent);
  const valid = plan.delegations.filter((d) => byName.has(d.agent));
  const results = await Promise.all(
    valid.map(async (d) => {
      onEvent(`📤 → ${d.agent}: ${d.message}`);
      const started = Date.now();
      const r = await byName.get(d.agent)!.run(d.message, (t) => t.statusText && onEvent(`   ⏳ ${d.agent}: ${TaskState[t.state].replace("TASK_STATE_", "").toLowerCase()} · ${t.statusText}`));
      onEvent(`📥 ← ${d.agent}: ${TaskState[r.state]} en ${((Date.now() - started) / 1000).toFixed(0)}s`);
      return { ...d, ...r };
    }),
  );

  // 4. Síntesis.
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: "Integra las respuestas de varios agentes en una respuesta final clara, en español, indicando qué aportó cada agente. Si alguno falló, dilo." },
      { role: "user", content: `Tarea: ${task}\n\n${results.map((r) => `## ${r.agent} (${TaskState[r.state]})\nPedido: ${r.message}\n${r.output || r.statusText}`).join("\n\n")}` },
    ],
  });
  return { agents, plan, results, skipped, answer: response.choices[0]?.message.content ?? "" };
}

const DEFAULT_TASK =
  "Prepará un informe breve sobre el protocolo MCP para alguien que se suma al equipo: qué es y su historia (contexto externo), " +
  "cómo se usa en los proyectos de este monorepo, y una revisión del último cambio mergeado en el repo.";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const urls = (process.env.A2A_AGENTS ?? "http://127.0.0.1:4101,http://127.0.0.1:4102,http://127.0.0.1:4103").split(",");
  const task = process.argv.slice(2).join(" ") || DEFAULT_TASK;
  const started = Date.now();
  orchestrate(task, urls, { client: createOpenAI(), model: defaultModel(), token: process.env.A2A_TOKEN, onEvent: console.log })
    .then((r) => {
      console.log(`\n✨ Respuesta final (${((Date.now() - started) / 1000).toFixed(0)}s):\n\n${r.answer}`);
      if (r.skipped.length) console.log(`\n⚠️ Delegaciones a agentes inexistentes ignoradas: ${r.skipped.join(", ")}`);
    })
    .catch((e) => {
      console.error("❌", e?.message ?? e);
      process.exit(1);
    });
}
