/**
 * Helpers para exponer cualquier función como un agente A2A (protocolo v1.0),
 * usando el SDK oficial `@a2a-js/sdk`. El SDK resuelve el protocolo (JSON-RPC,
 * almacenamiento de tareas, ciclo de vida); acá solo se escribe el "executor".
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { AGENT_CARD_PATH, Role, TaskState, type AgentCard, type AgentSkill, type Message, type Part, type Task } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore, type AgentExecutor } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";

export const textPart = (text: string): Part => ({ content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" });

/** Todo el texto de una lista de partes. */
export const partsText = (parts: Part[] = []) => parts.map((p) => (p.content?.$case === "text" ? p.content.value : "")).filter(Boolean).join("\n");

export function agentMessage(text: string, taskId: string, contextId: string): Message {
  return { messageId: randomUUID(), contextId, taskId, role: Role.ROLE_AGENT, parts: [textPart(text)], metadata: undefined, extensions: [], referenceTaskIds: [] };
}

export function userMessage(text: string): Message {
  return { messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER, parts: [textPart(text)], metadata: undefined, extensions: [], referenceTaskIds: [] };
}

export interface AgentDefinition {
  name: string;
  description: string;
  skills: Array<Pick<AgentSkill, "id" | "name" | "description"> & { examples?: string[]; tags?: string[] }>;
  /** La lógica del agente: recibe el texto del pedido y devuelve el resultado. `progress` publica estados intermedios. */
  handle: (input: string, progress: (note: string) => void) => Promise<string>;
}

/** La Agent Card: lo que un cliente lee para descubrir qué sabe hacer este agente y dónde llamarlo. */
export function buildAgentCard(def: AgentDefinition, url: string, { requiresToken = false } = {}): AgentCard {
  return {
    name: def.name,
    description: def.description,
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" }],
    provider: { organization: "agentic-engineering-sandbox", url: "https://github.com/dazpeitia-utn/agentic-engineering-sandbox" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: requiresToken
      ? { bearer: { scheme: { $case: "httpAuthSecurityScheme", value: { description: "Token compartido entre los agentes del sandbox", scheme: "Bearer", bearerFormat: "" } } } }
      : {},
    securityRequirements: requiresToken ? [{ schemes: { bearer: { list: [] } } }] : [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: def.skills.map((s) => ({ ...s, tags: s.tags ?? [], examples: s.examples ?? [], inputModes: ["text/plain"], outputModes: ["text/plain"], securityRequirements: [] })),
    signatures: [],
  } as AgentCard;
}

const status = (taskId: string, contextId: string, state: TaskState, text?: string) => ({
  kind: "statusUpdate" as const,
  data: { taskId, contextId, status: { state, message: text ? agentMessage(text, taskId, contextId) : undefined, timestamp: new Date().toISOString() }, metadata: undefined },
});

/**
 * El executor: traduce el ciclo de vida A2A a una llamada a `handle`.
 * submitted → working (+ notas de progreso) → artifact con el resultado → completed, o failed si tira error.
 */
export function executorFor(def: AgentDefinition): AgentExecutor {
  const canceled = new Set<string>();
  return {
    async execute(ctx, bus) {
      const { taskId, contextId } = ctx;
      const input = partsText(ctx.userMessage.parts);
      const task: Task = { id: taskId, contextId, status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() }, artifacts: [], history: [ctx.userMessage], metadata: undefined };
      bus.publish({ kind: "task", data: task });
      bus.publish(status(taskId, contextId, TaskState.TASK_STATE_WORKING, `${def.name} trabajando...`));
      try {
        const result = await def.handle(input, (note) => {
          if (!canceled.has(taskId)) bus.publish(status(taskId, contextId, TaskState.TASK_STATE_WORKING, note));
        });
        if (canceled.has(taskId)) return;
        bus.publish({
          kind: "artifactUpdate",
          data: { taskId, contextId, artifact: { artifactId: randomUUID(), name: "resultado", description: `Resultado de ${def.name}`, parts: [textPart(result)], metadata: undefined, extensions: [] }, append: false, lastChunk: true, metadata: undefined },
        });
        bus.publish(status(taskId, contextId, TaskState.TASK_STATE_COMPLETED));
      } catch (error: any) {
        bus.publish(status(taskId, contextId, TaskState.TASK_STATE_FAILED, `Error: ${error?.message ?? error}`));
      } finally {
        bus.finished();
      }
    },
    async cancelTask(taskId, bus) {
      canceled.add(taskId);
      bus.publish(status(taskId, "", TaskState.TASK_STATE_CANCELED, "Cancelada por el cliente"));
      bus.finished();
    },
  };
}

/** Arma la app HTTP de un agente: Agent Card pública + endpoint JSON-RPC (opcionalmente con token). */
export function createAgentApp(def: AgentDefinition, url: string, { token }: { token?: string } = {}) {
  const card = buildAgentCard(def, url, { requiresToken: Boolean(token) });
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executorFor(def));
  const app = express();
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: async () => card }));
  if (token) {
    const expected = Buffer.from(`Bearer ${token}`);
    app.use((req, res, next) => {
      const given = Buffer.from(req.headers.authorization ?? "");
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
      res.status(401).json({ error: "Token A2A inválido o ausente" });
    });
  }
  app.use("/", jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  return { app, card };
}

export async function listen(app: express.Express, port: number, host = "127.0.0.1"): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => resolve(server));
  });
}
