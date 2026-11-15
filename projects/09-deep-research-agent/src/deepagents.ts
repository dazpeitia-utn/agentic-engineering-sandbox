/**
 * La misma investigación con el paquete `deepagents` de LangChain, para comparar.
 * Usa las mismas tools de investigación y el mismo registro de fuentes; lo que
 * cambia es el "harness": deepagents trae de serie write_todos, task
 * (subagentes), un filesystem virtual en el estado y summarization.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { agentHeaders, defaultModel, requireEnv, type AgentTool } from "@sandbox/agent-core";
import { checkCitations, withSourcesSection, type CitationCheck } from "./citations.js";
import { SourceRegistry, type Source } from "./sources.js";
import { monorepoDocsTool, wikipediaTools, type DocsHit } from "./tools/research.js";

/** Adapta una AgentTool nuestra a una tool de LangChain (acepta JSON Schema directamente). */
// Los errores vuelven al modelo como texto (igual que en runAgent): una tool que falla no debe tirar toda la corrida.
const toLangChain = (t: AgentTool) =>
  tool(
    async (args: Record<string, unknown>) => {
      try {
        return await t.execute(args);
      } catch (error: any) {
        return `Error ejecutando ${t.name}: ${error?.message ?? error}`;
      }
    },
    { name: t.name, description: t.description, schema: t.parameters as any },
  );

const chat = (model: string) =>
  new ChatOpenAI({
    model,
    temperature: 0,
    apiKey: requireEnv("OPENAI_API_KEY"),
    // Respeta el proxy del 07 igual que agent-core.
    configuration: { baseURL: process.env.OPENAI_BASE_URL, defaultHeaders: agentHeaders() },
  });

export async function runDeepResearchWithDeepagents(
  question: string,
  { workspaceDir, model = defaultModel(), subagentModel = "gpt-4o-mini", docsSearch }: { workspaceDir: string; model?: string; subagentModel?: string; docsSearch?: (q: string) => Promise<DocsHit[]> },
): Promise<{ report: string | null; reportFile: string; sources: Source[]; citations: CitationCheck | null; messages: number }> {
  const registry = new SourceRegistry();
  const research = [...wikipediaTools(registry), ...(docsSearch ? [monorepoDocsTool(registry, docsSearch)] : [])].map(toLangChain);

  const agent = createDeepAgent({
    model: chat(model),
    tools: [],
    systemPrompt:
      "Eres un agente de investigación profunda. Planifica con write_todos, delega cada subpregunta al subagente 'researcher' con task " +
      "(pidiéndole que guarde notas en /notes/<tema>.md con citas [S#]), lee las notas y escribe el informe final en /report.md con write_file: " +
      "título, resumen, una sección por subpregunta y '## Fuentes'. Cada afirmación lleva su cita [S1] o [S1, S3], usando solo ids de las notas.",
    subagents: [
      {
        name: "researcher",
        description: "Investiga una subpregunta en Wikipedia y en la documentación del monorepo y guarda notas con fuentes.",
        systemPrompt:
          "Busca con wikipedia_search (es y en) o monorepo_docs_search, lee con wikipedia_page (solo lo leído es citable, cada lectura da un id S#), " +
          "guarda hallazgos con citas [S#] en el archivo de notas indicado y responde con un resumen breve con sus ids.",
        tools: research,
        model: chat(subagentModel),
      },
    ],
  });

  const state: any = await agent.invoke({ messages: [{ role: "user", content: `Pregunta de investigación: ${question}` }] }, { recursionLimit: 80 });
  const file = state.files?.["/report.md"];
  const raw: string | null = file ? (Array.isArray(file.content) ? file.content.join("\n") : String(file.content ?? "")) : null;

  await fs.mkdir(workspaceDir, { recursive: true });
  const reportFile = path.join(workspaceDir, "report.md");
  let report: string | null = null;
  let citations: CitationCheck | null = null;
  if (raw) {
    citations = checkCitations(raw, registry.all());
    report = withSourcesSection(raw, registry.all(), citations.cited);
    await fs.writeFile(reportFile, report);
  }
  return { report, reportFile, sources: registry.all(), citations, messages: state.messages?.length ?? 0 };
}
