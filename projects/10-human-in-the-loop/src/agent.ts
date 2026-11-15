import fs from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import {
  END,
  START,
  StateGraph,
  appendReducer,
  generateStructured,
  resolveInside,
  runVitest,
  type ChatClient,
  type Checkpointer,
} from "@sandbox/agent-core";

/** Un cambio propuesto por el agente: nunca se aplica sin pasar por la revisión. */
export interface Change {
  file: string;
  newContent: string;
  reason: string;
}

export type DecisionKind = "approve" | "reject" | "edit";

export interface Decision {
  file: string;
  decision: DecisionKind;
  /** Quién decidió: una persona o la política de auto-aprobación. */
  by: "human" | "policy";
  /** Contenido final si la persona lo editó. */
  content?: string;
  comment?: string;
}

/** Lo que la persona responde a un interrupt. */
export interface HumanAnswer {
  decision: DecisionKind;
  content?: string;
  comment?: string;
}

/** Lo que el grafo muestra cuando pide aprobación. */
export interface ApprovalRequest {
  index: number;
  total: number;
  file: string;
  reason: string;
  diff: string;
}

export interface HitlState {
  task: string;
  workspaceDir: string;
  proposals: Change[];
  decisions: Decision[];
  applied: string[];
  testsPassed: boolean | null;
  testOutput: string;
}

/**
 * Política de aprobación: qué acciones necesitan a una persona. Los cambios de
 * documentación se aprueban solos; cualquier cambio de código, no.
 */
export type ApprovalPolicy = (change: Change) => boolean;
export const defaultPolicy: ApprovalPolicy = (change) => !/\.(md|txt)$/i.test(change.file);

export function unifiedDiff(file: string, before: string, after: string): string {
  return createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after, "", "", { context: 2 });
}

async function readWorkspace(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.name === "node_modules") continue;
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(dir, full)] = await fs.readFile(full, "utf-8");
    }
  };
  await walk(dir);
  return out;
}

const changesSchema = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "Ruta relativa de un archivo existente" },
          newContent: { type: "string", description: "Contenido completo nuevo del archivo" },
          reason: { type: "string" },
        },
        required: ["file", "newContent", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["changes"],
  additionalProperties: false,
};

/** El agente propone cambios leyendo el workspace. Solo propone: no escribe nada. */
export function llmProposer(client: ChatClient, model: string) {
  return async (task: string, files: Record<string, string>): Promise<Change[]> => {
    const listing = Object.entries(files).map(([f, c]) => `=== ${f}\n${c}`).join("\n\n");
    const { changes } = await generateStructured<{ changes: Change[] }>({
      client,
      model,
      name: "changes",
      schema: changesSchema,
      system:
        "Eres un agente de refactor. Propones cambios a archivos existentes para cumplir la tarea; una persona los revisa antes de aplicarlos. " +
        "Un cambio por archivo, con el contenido completo nuevo. Solo incluye archivos que realmente cambian. No modifiques tests salvo que la tarea lo pida.",
      user: `Tarea: ${task}\n\nArchivos del proyecto:\n\n${listing}`,
    });
    return changes;
  };
}

export type Proposer = (task: string, files: Record<string, string>) => Promise<Change[]>;

/**
 * Grafo: propose → review (un interrupt por cambio que requiere aprobación) → apply.
 * El interrupt está en un nodo propio y barato: al retomar, el nodo se re-ejecuta
 * desde el principio, así que el LLM (en propose) no se vuelve a llamar.
 */
export function buildHitlGraph({ propose, policy = defaultPolicy, checkpointer }: { propose: Proposer; policy?: ApprovalPolicy; checkpointer: Checkpointer<HitlState> }) {
  return new StateGraph<HitlState>({ decisions: appendReducer, applied: appendReducer })
    .addNode("propose", async (s) => {
      const files = await readWorkspace(s.workspaceDir);
      const proposals = await propose(s.task, files);
      for (const change of proposals) {
        // El agente no puede proponer cambios fuera del workspace ni crear archivos.
        await resolveInside(s.workspaceDir, change.file);
        if (!(change.file in files)) throw new Error(`El agente propuso un archivo que no existe: ${change.file}`);
      }
      return { proposals: proposals.filter((c) => files[c.file] !== c.newContent) };
    })
    .addNode("review", async (s, ctx) => {
      const index = s.decisions.length;
      const change = s.proposals[index];
      if (!policy(change)) return { decisions: [{ file: change.file, decision: "approve", by: "policy" }] };
      const before = await fs.readFile(path.join(s.workspaceDir, change.file), "utf-8");
      const answer = ctx.interrupt<HumanAnswer>({
        index: index + 1,
        total: s.proposals.length,
        file: change.file,
        reason: change.reason,
        diff: unifiedDiff(change.file, before, change.newContent),
      } satisfies ApprovalRequest);
      if (!["approve", "reject", "edit"].includes(answer?.decision)) throw new Error(`Respuesta inválida: ${JSON.stringify(answer)}`);
      if (answer.decision === "edit" && typeof answer.content !== "string") throw new Error("Para editar hace falta el contenido nuevo.");
      return { decisions: [{ file: change.file, decision: answer.decision, by: "human", content: answer.content, comment: answer.comment }] };
    })
    .addNode("apply", async (s) => {
      const applied: string[] = [];
      for (const [i, decision] of s.decisions.entries()) {
        if (decision.decision === "reject") continue;
        const content = decision.decision === "edit" ? decision.content! : s.proposals[i].newContent;
        await fs.writeFile(await resolveInside(s.workspaceDir, decision.file), content);
        applied.push(decision.file);
      }
      const testFiles = Object.keys(await readWorkspace(s.workspaceDir)).filter((f) => f.endsWith(".test.ts"));
      if (applied.length === 0 || testFiles.length === 0) return { applied, testsPassed: null };
      const results = await Promise.all(testFiles.map((f) => runVitest(s.workspaceDir, f)));
      return { applied, testsPassed: results.every((r) => r.passed), testOutput: results.map((r) => r.output.split("\n").slice(-6).join("\n")).join("\n") };
    })
    .addEdge(START, "propose")
    .addConditionalEdges("propose", (s) => (s.proposals.length ? "review" : END), ["review", END])
    .addConditionalEdges("review", (s) => (s.decisions.length < s.proposals.length ? "review" : "apply"), ["review", "apply"])
    .addEdge("apply", END)
    .compile({ checkpointer, maxSteps: 100 });
}

export const initialHitlState = (task: string, workspaceDir: string): HitlState => ({
  task,
  workspaceDir,
  proposals: [],
  decisions: [],
  applied: [],
  testsPassed: null,
  testOutput: "",
});
