import fs from "node:fs/promises";
import path from "node:path";
import { requireString, resolveInside, runAgent, type AgentEvent, type AgentTool, type ChatClient, type CompactionOptions } from "@sandbox/agent-core";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * write_todos: la "herramienta de planificación" de los deep agents. No hace
 * nada en el mundo: obliga al agente a escribir su plan y lo mantiene visible
 * en el contexto aunque la conversación crezca.
 */
export function todoTool(onChange: (todos: Todo[]) => void = () => {}): AgentTool & { todos: () => Todo[] } {
  let todos: Todo[] = [];
  return {
    todos: () => todos,
    name: "write_todos",
    description: "Escribe o actualiza tu lista de tareas (reemplaza la anterior). Úsala al empezar y cada vez que avances.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
            required: ["content", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    async execute(args) {
      if (!Array.isArray(args.todos)) throw new Error('"todos" debe ser una lista.');
      todos = (args.todos as Todo[]).map((t) => ({ content: String(t.content), status: ["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending" }));
      onChange(todos);
      const icon = { pending: "⬜", in_progress: "🔄", completed: "✅" };
      return `Lista actualizada:\n${todos.map((t) => `${icon[t.status]} ${t.content}`).join("\n")}`;
    },
  };
}

/** ls: lista los archivos del workspace de la corrida (el "filesystem" que usan como memoria). */
export function lsTool(rootDir: string): AgentTool {
  return {
    name: "ls",
    description: "Lista los archivos de tu espacio de trabajo (notas, borradores).",
    parameters: { type: "object", properties: { dir: { type: "string", description: "Carpeta relativa (default: raíz)" } }, additionalProperties: false },
    async execute(args) {
      const dir = await resolveInside(rootDir, typeof args.dir === "string" ? args.dir : ".");
      const walk = async (d: string): Promise<string[]> => {
        const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
        const out: string[] = [];
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) out.push(...(await walk(full)));
          else out.push(`${path.relative(rootDir, full)} (${(await fs.stat(full)).size} bytes)`);
        }
        return out;
      };
      const files = await walk(dir);
      return files.length ? files.join("\n") : "(vacío)";
    },
  };
}

export interface SubagentSpec {
  name: string;
  description: string;
  system: string;
  tools: AgentTool[];
  maxIterations?: number;
}

/**
 * task: delega una subtarea a un subagente con **contexto limpio**. El
 * subagente solo ve la descripción de la tarea; el agente principal solo recibe
 * el resultado final. Así una investigación de 15 pasos no llena el contexto
 * principal: es el "aislamiento de contexto" de los deep agents.
 */
export function taskTool({
  client,
  model,
  subagents,
  onEvent = () => {},
  maxResultChars = 4000,
}: {
  client: ChatClient;
  model: string;
  subagents: SubagentSpec[];
  onEvent?: (subagent: string, description: string, event: AgentEvent | { type: "start" }) => void;
  maxResultChars?: number;
}): AgentTool {
  const byName = new Map(subagents.map((s) => [s.name, s]));
  return {
    name: "task",
    description:
      "Delega una subtarea a un subagente que arranca con contexto vacío y devuelve solo su resultado. Disponibles: " +
      subagents.map((s) => `${s.name} (${s.description})`).join("; ") +
      ". La descripción debe ser autocontenida: el subagente no ve tu conversación.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Qué tiene que hacer, con todo el contexto necesario." },
        subagent: { type: "string", enum: subagents.map((s) => s.name) },
      },
      required: ["description", "subagent"],
      additionalProperties: false,
    },
    async execute(args) {
      const description = requireString(args, "description");
      const spec = byName.get(requireString(args, "subagent"));
      if (!spec) throw new Error(`No existe el subagente "${args.subagent}".`);
      onEvent(spec.name, description, { type: "start" });
      const result = await runAgent({
        name: `subagent ${spec.name}`,
        client,
        model,
        system: spec.system,
        user: description,
        tools: spec.tools,
        maxIterations: spec.maxIterations ?? 10,
        onEvent: (e) => onEvent(spec.name, description, e),
      });
      const text = result.finalText ?? `(el subagente no terminó en ${result.iterations} pasos; lo que haya escrito en archivos sigue disponible)`;
      return text.length > maxResultChars ? `${text.slice(0, maxResultChars)}\n...[resultado recortado]` : text;
    },
  };
}

/** Resumidor para la compactación: condensa mensajes viejos en notas que preservan fuentes y decisiones. */
export function llmSummarizer(client: ChatClient, model: string): CompactionOptions["summarize"] {
  return async (messages) => {
    const transcript = messages
      .map((m: any) => `${m.role}${m.tool_calls ? ` → ${m.tool_calls.map((t: any) => t.function?.name).join(", ")}` : ""}: ${typeof m.content === "string" ? m.content.slice(0, 3000) : ""}`)
      .join("\n");
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: "Resume este tramo del trabajo de un agente investigador. Conserva: hallazgos con sus ids de fuente (S1, S2...), decisiones, archivos escritos y qué falta. Máximo 250 palabras." },
        { role: "user", content: transcript },
      ],
    });
    return response.choices[0]?.message.content ?? "(sin resumen)";
  };
}
