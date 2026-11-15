import fs from "node:fs/promises";
import path from "node:path";
import { runVitest } from "@sandbox/agent-core";
import { runUnitTesterAgent } from "01-agent-unit-tester/agent";
import { runBugFixerAgent } from "04-autonomous-bug-fixer/agent";
import { createAgents } from "06-multi-agent-orchestrator/agents";
import { runCustom } from "06-multi-agent-orchestrator/custom";
import { initialState, type NodeName } from "06-multi-agent-orchestrator/state";
import { runDeepResearch } from "09-deep-research-agent/agent";
import { searchRelevantDocs } from "03-rag-docs-assistant/search";
import { PROJECT_ROOT } from "../core/runner.js";
import type { EvalCase, Suite } from "../core/types.js";
import { bugFixerCases, type BugFixerInput } from "../datasets/bugFixer.js";
import { orchestratorCases, type OrchestratorInput } from "../datasets/orchestrator.js";
import { unitTesterCases, type UnitTesterInput } from "../datasets/unitTester.js";
import { hiddenSpecEvaluator, llmJudge, type HiddenSpec } from "../evaluators/index.js";

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), content);
  }
}

const readOr = (file: string, fallback = "(no existe)") => fs.readFile(file, "utf-8").catch(() => fallback);

/** Líneas que cambian entre dos versiones (diff aproximado por conjunto de líneas). */
export function changedLines(before: string, after: string): number {
  const a = before.split("\n").map((l) => l.trim()).filter(Boolean);
  const b = after.split("\n").map((l) => l.trim()).filter(Boolean);
  const removed = a.filter((l) => !b.includes(l)).length;
  const added = b.filter((l) => !a.includes(l)).length;
  return Math.max(removed, added);
}

// ---------------------------------------------------------------------------
// slugify-fixtures: sin API. Valida el evaluador con implementaciones reales.
// ---------------------------------------------------------------------------

interface FixtureInput {
  file: string;
  exportName: string;
  hidden: HiddenSpec;
  /** Lo que el evaluador DEBERÍA decir: así testeamos al evaluador (meta-eval). */
  expectedPass: boolean;
}

const fixture = (id: string, description: string, expectedPass: boolean): EvalCase<FixtureInput> => ({
  id,
  description,
  input: { file: path.join(PROJECT_ROOT, "fixtures/slugify", `${id}.ts`), exportName: "slugify", hidden: { kind: "slugify-properties" }, expectedPass },
});

export const slugifyFixturesSuite: Suite<FixtureInput, { moduleFile: string }> = {
  name: "slugify-fixtures",
  description: "Evalúa con property-based testing las implementaciones de slugify que generó el proyecto 06 (sin API).",
  usesLlm: false,
  variants: [{ name: "default" }],
  cases: [
    fixture("reference", "Implementación de referencia, escrita a mano.", true),
    fixture("buggy-06-langgraph", "Generada por el 06 con LangGraph: aprobada por tests y revisor.", false),
    fixture("custom-06", "Generada por el 06 con el motor propio: aprobada por tests y revisor.", false),
  ],
  run: async (c) => ({ moduleFile: c.input.file }),
  evaluators: [hiddenSpecEvaluator("slugify_properties")],
};

// ---------------------------------------------------------------------------
// bug-fixer (04)
// ---------------------------------------------------------------------------

interface BugFixerOutput {
  moduleFile: string | null;
  visiblePassed: boolean;
  summary: string | null;
  before: string;
  after: string;
}

export const bugFixerSuite: Suite<BugFixerInput, BugFixerOutput> = {
  name: "bug-fixer",
  description: "¿El agente 04 arregla la causa raíz o solo hace pasar el test visible?",
  usesLlm: true,
  variants: [{ name: "default", description: "Prompt actual del 04." }],
  cases: bugFixerCases,
  setup: (c, ctx) => writeFiles(ctx.workspaceDir, c.input.files),
  async run(c, ctx) {
    const result = await runBugFixerAgent(c.input.testFile, { rootDir: ctx.workspaceDir, client: ctx.client, model: ctx.model, verbose: false });
    const moduleFile = path.join(ctx.workspaceDir, c.input.sourceFile);
    return { moduleFile, visiblePassed: result.fixed, summary: result.summary, before: c.input.files[c.input.sourceFile], after: await readOr(moduleFile) };
  },
  evaluators: [
    { name: "visible_test", evaluate: async (_c, o) => ({ evaluator: "visible_test", score: o.visiblePassed ? 1 : 0, pass: o.visiblePassed, reason: o.visiblePassed ? "El test visible pasa" : "El test visible sigue fallando" }) },
    hiddenSpecEvaluator("hidden_checks"),
    {
      name: "patch_size",
      async evaluate(_c, o) {
        const lines = changedLines(o.before, o.after);
        return { evaluator: "patch_size", score: lines <= 3 ? 1 : lines <= 8 ? 0.5 : 0, pass: lines <= 8, reason: `${lines} línea(s) cambiada(s)` };
      },
    },
    llmJudge<BugFixerInput, BugFixerOutput>({
      rubric:
        "5: el parche arregla la causa raíz de forma general, es mínimo y la explicación es correcta.\n" +
        "4: arregla la causa raíz con algún detalle menor.\n" +
        "3: hace pasar el test pero la solución es dudosa o parcial.\n" +
        "2: el parche es un caso especial (sobreajuste al test) o la explicación es incorrecta.\n" +
        "1: no arregla el bug.",
      prompt: (c, o) =>
        `Causa raíz real del bug: ${c.input.rootCause}\n\nCódigo original:\n${o.before}\n\nCódigo después del parche:\n${o.after}\n\nExplicación del agente:\n${o.summary ?? "(ninguna)"}`,
    }),
  ],
};

// ---------------------------------------------------------------------------
// unit-tester (01): mutation testing
// ---------------------------------------------------------------------------

interface UnitTesterOutput {
  testsPassed: boolean;
  testFile: string;
  killed: string[];
  survived: string[];
}

export const unitTesterSuite: Suite<UnitTesterInput, UnitTesterOutput> = {
  name: "unit-tester",
  description: "¿Los tests que genera el agente 01 detectan bugs? Se mide con mutation testing.",
  usesLlm: true,
  variants: [{ name: "default", description: "Prompt actual del 01." }],
  cases: unitTesterCases,
  setup: (c, ctx) => writeFiles(ctx.workspaceDir, { [c.input.sourceFile]: c.input.source }),
  async run(c, ctx) {
    const { workspaceDir: dir } = ctx;
    const { testsPassed } = await runUnitTesterAgent(c.input.sourceFile, c.input.testFile, { rootDir: dir, client: ctx.client, model: ctx.model, verbose: false });
    const sourcePath = path.join(dir, c.input.sourceFile);
    const killed: string[] = [];
    const survived: string[] = [];
    if (testsPassed) {
      for (const mutant of c.input.mutants) {
        if (!c.input.source.includes(mutant.find)) throw new Error(`El mutante ${mutant.id} no encuentra su texto en el código.`);
        await fs.writeFile(sourcePath, c.input.source.replace(mutant.find, mutant.replace));
        const result = await runVitest(dir, c.input.testFile);
        (result.passed ? survived : killed).push(mutant.id);
      }
      await fs.writeFile(sourcePath, c.input.source);
    }
    return { testsPassed, testFile: path.join(dir, c.input.testFile), killed, survived };
  },
  evaluators: [
    { name: "tests_pass", evaluate: async (_c, o) => ({ evaluator: "tests_pass", score: o.testsPassed ? 1 : 0, pass: o.testsPassed, reason: o.testsPassed ? "Los tests generados pasan con el código correcto" : "Los tests generados fallan con el código correcto" }) },
    {
      name: "mutation_score",
      async evaluate(c, o) {
        const total = c.input.mutants.length;
        const score = o.killed.length / total;
        return {
          evaluator: "mutation_score",
          score,
          pass: o.testsPassed && score >= c.input.minMutationScore,
          reason: `${o.killed.length}/${total} mutantes detectados${o.survived.length ? `; sobreviven: ${o.survived.join(", ")}` : ""}`,
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// orchestrator (06): tareas completas + comparación de prompts
// ---------------------------------------------------------------------------

interface OrchestratorOutput {
  moduleFile: string | null;
  approved: boolean;
  testsPassed: boolean;
  attempts: number;
}

/** Variante "thorough": instrucciones extra genéricas para el tester y el desarrollador. */
const THOROUGH: Partial<Record<NodeName, string>> = {
  tester:
    "Además de los casos del plan, agrega casos de borde exhaustivos: cada carácter especial, acentuado o separador " +
    "que mencione la tarea (probando cada uno por separado), entradas vacías, valores límite, combinaciones y entradas inválidas.",
  developer:
    "Prefiere las APIs estándar de la plataforma (ej: String.prototype.normalize, Intl, expresiones regulares con clases explícitas) " +
    "a tablas manuales de caracteres. Revisa que la implementación sea correcta para cualquier entrada, no solo para los tests.",
};

export const orchestratorSuite: Suite<OrchestratorInput, OrchestratorOutput> = {
  name: "orchestrator",
  description: "Tareas completas del orquestador multiagente (06), verificadas con chequeos ocultos.",
  usesLlm: true,
  variants: [
    { name: "baseline", description: "Prompts actuales del 06." },
    { name: "thorough", description: "Tester con casos de borde exhaustivos y desarrollador que prefiere APIs estándar.", config: { instructions: THOROUGH } },
  ],
  cases: orchestratorCases,
  async run(c, ctx) {
    await fs.mkdir(path.join(ctx.workspaceDir, "src"), { recursive: true });
    const instructions = ctx.variant.config?.instructions as Partial<Record<NodeName, string>> | undefined;
    const agents = createAgents({ client: ctx.client, model: ctx.model, workspaceDir: ctx.workspaceDir, verbose: false, instructions });
    const { state } = await runCustom(agents, initialState(c.input.task), { maxAttempts: 3, threadId: `eval-${c.id}` });
    return {
      moduleFile: state.plan ? path.join(ctx.workspaceDir, state.plan.sourceFile) : null,
      approved: Boolean(state.review?.approved),
      testsPassed: Boolean(state.testReport?.passed),
      attempts: state.attempts,
    };
  },
  evaluators: [
    hiddenSpecEvaluator("hidden_checks"),
    // El "juez" acá es el propio revisor LLM del 06: medimos cuánto coincide su aprobación con la verdad.
    {
      name: "reviewer_approved",
      gating: false,
      evaluate: async (_c, o) => ({
        evaluator: "reviewer_approved",
        score: o.approved && o.testsPassed ? 1 : 0,
        pass: o.approved && o.testsPassed,
        reason: `El 06 dijo: tests ${o.testsPassed ? "pasan" : "fallan"}, revisor ${o.approved ? "aprobó" : "no aprobó"} (${o.attempts} intento/s)`,
      }),
    },
  ],
};

// ---------------------------------------------------------------------------
// deep-research (09)
// ---------------------------------------------------------------------------

interface DeepResearchInput {
  question: string;
  /** Temas que un buen informe tiene que cubrir (los evalúa el juez). */
  mustCover: string[];
  minCitedSources: number;
}

interface DeepResearchOutput {
  report: string | null;
  cited: string[];
  invalid: string[];
  uncitedParagraphs: number;
  sources: number;
  /** Fragmentos de las fuentes citadas: el juez evalúa contra esto, no contra lo que "recuerda". */
  citedExcerpts: Array<{ id: string; title: string; excerpt: string }>;
}

const docsSearch = async (query: string) =>
  (await searchRelevantDocs(query, { topK: 3, rerank: false })).map((d) => ({ source: d.source, section: d.section, content: d.content }));

export const deepResearchSuite: Suite<DeepResearchInput, DeepResearchOutput> = {
  name: "deep-research",
  description: "¿El deep agent (09) entrega un informe con fuentes reales, sin citas inventadas y cubriendo la pregunta?",
  usesLlm: true,
  variants: [{ name: "default" }],
  cases: [
    {
      id: "mcp-vs-a2a",
      description: "Pregunta mixta: Wikipedia + documentación del monorepo.",
      input: {
        question: "¿Qué es el Model Context Protocol (MCP), quién lo creó y cómo se usa en este monorepo? Compararlo con el protocolo A2A.",
        mustCover: ["qué es MCP", "quién lo creó (Anthropic)", "uso en los proyectos del monorepo", "qué es A2A", "diferencias MCP vs A2A"],
        minCitedSources: 3,
      },
    },
  ],
  async run(c, ctx) {
    const result = await runDeepResearch(c.input.question, { workspaceDir: ctx.workspaceDir, client: ctx.client, model: ctx.model, docsSearch });
    return {
      report: result.report,
      cited: result.citations?.cited ?? [],
      invalid: result.citations?.invalid ?? [],
      uncitedParagraphs: result.citations?.uncitedParagraphs ?? 0,
      sources: result.sources.length,
      citedExcerpts: result.sources.filter((s) => result.citations?.cited.includes(s.id)).map((s) => ({ id: s.id, title: s.title, excerpt: s.excerpt })),
    };
  },
  evaluators: [
    { name: "report_written", evaluate: async (_c, o) => ({ evaluator: "report_written", score: o.report ? 1 : 0, pass: Boolean(o.report), reason: o.report ? `${o.report.length} caracteres` : "No escribió report.md" }) },
    {
      name: "no_invented_citations",
      evaluate: async (_c, o) => ({ evaluator: "no_invented_citations", score: o.invalid.length === 0 ? 1 : 0, pass: o.invalid.length === 0, reason: o.invalid.length ? `Citas a fuentes nunca consultadas: ${o.invalid.join(", ")}` : `${o.cited.length} citas, todas a fuentes consultadas` }),
    },
    {
      name: "cited_sources",
      evaluate: async (c, o) => ({ evaluator: "cited_sources", score: Math.min(1, o.cited.length / c.input.minCitedSources), pass: o.cited.length >= c.input.minCitedSources, reason: `${o.cited.length} fuentes citadas de ${o.sources} consultadas (mínimo ${c.input.minCitedSources})` }),
    },
    {
      name: "paragraphs_cited",
      evaluate: async (_c, o) => ({ evaluator: "paragraphs_cited", score: o.uncitedParagraphs === 0 ? 1 : o.uncitedParagraphs <= 2 ? 0.5 : 0, pass: o.uncitedParagraphs <= 2, reason: `${o.uncitedParagraphs} párrafo(s) sin cita` }),
    },
    llmJudge<DeepResearchInput, DeepResearchOutput>({
      name: "coverage_judge",
      rubric:
        "5: cubre todos los temas pedidos con precisión y cada afirmación tiene una cita que la respalda.\n" +
        "4: cubre casi todo; algún detalle menor sin respaldo.\n3: falta un tema o hay citas que no respaldan lo afirmado.\n" +
        "2: faltan varios temas o hay errores factuales.\n1: no responde la pregunta.",
      // Lección de la primera corrida: sin fecha ni fuentes, el juez marcó como "imposible" un dato correcto de 2024
      // porque su conocimiento termina antes. Ahora juzga SOLO contra los fragmentos de las fuentes citadas.
      prompt: (c, o) =>
        `Fecha de hoy: ${new Date().toISOString().slice(0, 10)}. Tu conocimiento puede estar desactualizado: NO uses lo que recuerdas para ` +
        `juzgar si un dato es verdadero. Juzga la precisión SOLO contra los fragmentos de las fuentes citadas que aparecen abajo.\n\n` +
        `Temas que debe cubrir: ${c.input.mustCover.join("; ")}\n\nFuentes citadas:\n` +
        o.citedExcerpts.map((s) => `[${s.id}] ${s.title}\n${s.excerpt}`).join("\n\n") +
        `\n\nInforme:\n${o.report ?? "(sin informe)"}`,
    }),
  ],
};

export const SUITES: Record<string, Suite> = Object.fromEntries(
  [slugifyFixturesSuite, bugFixerSuite, unitTesterSuite, orchestratorSuite, deepResearchSuite].map((s) => [s.name, s as Suite]),
);
