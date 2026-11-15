import fs from "node:fs/promises";
import path from "node:path";
import { createFsTools, createOpenAI, defaultModel, runAgent, type AgentEvent, type ChatClient } from "@sandbox/agent-core";
import { checkCitations, withSourcesSection, type CitationCheck } from "./citations.js";
import { SourceRegistry, type Source } from "./sources.js";
import { llmSummarizer, lsTool, taskTool, todoTool, type Todo } from "./tools/planning.js";
import { monorepoDocsTool, wikipediaTools, type DocsHit, type Fetcher } from "./tools/research.js";

export interface DeepResearchOptions {
  /** Carpeta de la corrida: es el filesystem del agente (notas, borradores, informe). */
  workspaceDir: string;
  client?: ChatClient;
  /** Modelo del agente principal. */
  model?: string;
  /** Modelo de los subagentes: suele convenir uno más barato (default gpt-4o-mini). */
  subagentModel?: string;
  maxIterations?: number;
  /** Tamaño de contexto (en caracteres) a partir del cual se compacta. */
  compactAtChars?: number;
  fetcher?: Fetcher;
  docsSearch?: (query: string) => Promise<DocsHit[]>;
  onEvent?: (event: DeepResearchEvent) => void;
}

export type DeepResearchEvent =
  | { type: "todos"; todos: Todo[] }
  | { type: "main"; event: AgentEvent }
  | { type: "subagent"; subagent: string; description: string; event: AgentEvent | { type: "start" } };

export interface DeepResearchResult {
  report: string | null;
  reportFile: string;
  sources: Source[];
  citations: CitationCheck | null;
  todos: Todo[];
  stoppedReason: "completed" | "max_iterations";
  iterations: number;
  compactions: number;
  subagentCalls: number;
}

const MAIN_PROMPT = `Eres un agente de investigación profunda. Respondes preguntas abiertas con un informe en markdown basado en fuentes reales.

Tu forma de trabajar:
1. Empieza con write_todos: divide la pregunta en 3 a 6 subpreguntas concretas. Actualiza la lista a medida que avanzas.
2. Delega cada subpregunta con la tool task al subagente "researcher". Su descripción debe ser autocontenida (no ve tu conversación) y pedirle que guarde sus hallazgos en notes/<tema>.md citando las fuentes por id.
3. Lee las notas con read_file (usa ls para verlas). No investigues tú directamente: tu trabajo es planificar, delegar y sintetizar.
4. Escribe el informe final con write_file en report.md: título, resumen, una sección por subpregunta y una sección "## Fuentes".
   Cada afirmación factual lleva la cita de su fuente con el formato [S1] o [S1, S3], usando SOLO ids que aparecieron en las notas. Si algo no se pudo confirmar, dilo.
5. Termina con un mensaje breve diciendo que report.md está listo.`;

const RESEARCHER_PROMPT = `Eres un subagente investigador. Recibes una subpregunta concreta.
1. Busca con wikipedia_search (prueba "es" y "en") y/o monorepo_docs_search si la pregunta es sobre este repositorio.
2. Lee las páginas relevantes con wikipedia_page: solo lo que leíste con wikipedia_page o monorepo_docs_search es citable, y cada lectura te da un id (S1, S2...).
3. Guarda tus hallazgos con write_file en el archivo de notas que te indicaron: viñetas con el dato y su cita [S#]. No inventes ids ni datos.
4. Responde con un resumen de 3 a 6 líneas de lo que encontraste, con sus ids.`;

/** Corre el deep agent y devuelve el informe validado (citas contra fuentes realmente consultadas). */
export async function runDeepResearch(question: string, options: DeepResearchOptions): Promise<DeepResearchResult> {
  const { workspaceDir, onEvent = () => {} } = options;
  const client = options.client ?? createOpenAI();
  const model = options.model ?? defaultModel();
  const subagentModel = options.subagentModel ?? "gpt-4o-mini";
  await fs.mkdir(path.join(workspaceDir, "notes"), { recursive: true });

  const registry = new SourceRegistry();
  const fsTools = createFsTools({ rootDir: workspaceDir, canWrite: (p) => p.endsWith(".md") });
  const researchTools = [
    ...wikipediaTools(registry, options.fetcher),
    ...(options.docsSearch ? [monorepoDocsTool(registry, options.docsSearch)] : []),
  ];
  const todos = todoTool((t) => onEvent({ type: "todos", todos: t }));
  let compactions = 0;
  let subagentCalls = 0;

  const result = await runAgent({
    client,
    model,
    system: MAIN_PROMPT,
    user: `Pregunta de investigación: ${question}`,
    tools: [
      todos,
      lsTool(workspaceDir),
      ...fsTools,
      taskTool({
        client,
        model: subagentModel,
        subagents: [
          {
            name: "researcher",
            description: "investiga una subpregunta en Wikipedia y en la documentación del monorepo, y guarda notas con fuentes",
            system: RESEARCHER_PROMPT,
            tools: [...researchTools, ...fsTools],
            maxIterations: 10,
          },
        ],
        onEvent: (subagent, description, event) => {
          if (event.type === "start") subagentCalls++;
          onEvent({ type: "subagent", subagent, description, event });
        },
      }),
    ],
    maxIterations: options.maxIterations ?? 25,
    compaction: { maxChars: options.compactAtChars ?? 60_000, keepLast: 6, summarize: llmSummarizer(client, subagentModel) },
    onEvent: (event) => {
      if (event.type === "compacted") compactions++;
      onEvent({ type: "main", event });
    },
  });

  const reportFile = path.join(workspaceDir, "report.md");
  const raw = await fs.readFile(reportFile, "utf-8").catch(() => null);
  let report: string | null = null;
  let citations: CitationCheck | null = null;
  if (raw) {
    citations = checkCitations(raw, registry.all());
    report = withSourcesSection(raw, registry.all(), citations.cited);
    await fs.writeFile(reportFile, report);
  }
  return {
    report,
    reportFile,
    sources: registry.all(),
    citations,
    todos: todos.todos(),
    stoppedReason: result.stoppedReason,
    iterations: result.iterations,
    compactions,
    subagentCalls,
  };
}
