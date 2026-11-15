/**
 * Tres agentes del monorepo expuestos por A2A. Cada uno es un servicio
 * independiente: el orquestador solo los conoce por su Agent Card.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGitReviewerAgent } from "02-mcp-git-code-reviewer/agent";
import { askRagAgent } from "03-rag-docs-assistant/agent";
import { searchRelevantDocs } from "03-rag-docs-assistant/search";
import { runDeepResearch } from "09-deep-research-agent/agent";
import { MONOREPO_ROOT } from "@sandbox/agent-core";
import type { AgentDefinition } from "./a2a.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const docsAgent: AgentDefinition = {
  name: "docs-agent",
  description: "Responde preguntas sobre los proyectos de este monorepo usando su documentación (RAG híbrido del proyecto 03).",
  skills: [{ id: "monorepo-docs", name: "Documentación del monorepo", description: "Cómo funciona o se usa algo en los proyectos del repositorio.", examples: ["¿Cómo se usa MCP en el proyecto 02?"] }],
  handle: async (input) => (await askRagAgent(input)) ?? "(sin respuesta)",
};

export const researchAgent: AgentDefinition = {
  name: "research-agent",
  description: "Investiga un tema abierto en fuentes externas (Wikipedia) y entrega un informe con citas verificadas (deep agent del proyecto 09).",
  skills: [{ id: "deep-research", name: "Investigación con fuentes", description: "Contexto, historia y comparación de tecnologías o conceptos, con citas.", examples: ["Historia y adopción del protocolo MCP"] }],
  async handle(input, progress) {
    const workspaceDir = path.join(PROJECT_ROOT, "runs", `research-${Date.now()}`);
    const docsSearch = async (q: string) => (await searchRelevantDocs(q, { topK: 3, rerank: false })).map((d) => ({ source: d.source, section: d.section, content: d.content }));
    const result = await runDeepResearch(input, {
      workspaceDir,
      docsSearch,
      maxIterations: 15,
      onEvent: (e) => {
        if (e.type === "subagent" && e.event.type === "start") progress(`subagente: ${e.description.slice(0, 80)}`);
      },
    });
    if (!result.report) throw new Error("El deep agent no escribió el informe.");
    return result.report;
  },
};

/** Lee un rango "base..head" del pedido; si no hay, revisa el último commit de la rama actual. */
export function parseRange(input: string): { base: string; head: string } {
  const match = input.match(/([\w./~^-]+)\.\.([\w./~^-]+)/);
  return match ? { base: match[1], head: match[2] } : { base: "HEAD~1", head: "HEAD" };
}

export const reviewerAgent: AgentDefinition = {
  name: "reviewer-agent",
  description: "Hace code review de commits del repositorio vía un servidor MCP de git, con veredicto APROBADO/BLOQUEAR (proyecto 02).",
  skills: [{ id: "code-review", name: "Code review de commits", description: "Revisa un rango de commits (base..head) o, si no se indica, el último commit.", examples: ["Revisá HEAD~1..HEAD", "Revisá el último cambio mergeado"] }],
  async handle(input) {
    const range = parseRange(input);
    const { review, verdict } = await runGitReviewerAgent({ range, cwd: MONOREPO_ROOT, quiet: true });
    return `Rango revisado: ${range.base}..${range.head} · Veredicto: ${verdict}\n\n${review ?? "(sin conclusión)"}`;
  },
};

export const AGENTS: Record<string, { def: AgentDefinition; port: number }> = {
  docs: { def: docsAgent, port: 4101 },
  research: { def: researchAgent, port: 4102 },
  reviewer: { def: reviewerAgent, port: 4103 },
};
