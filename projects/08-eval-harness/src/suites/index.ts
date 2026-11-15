import fs from "node:fs/promises";
import path from "node:path";
import { runVitest } from "@sandbox/agent-core";
import { runUnitTesterAgent } from "01-agent-unit-tester/agent";
import { runBugFixerAgent } from "04-autonomous-bug-fixer/agent";
import { createAgents } from "06-multi-agent-orchestrator/agents";
import { runCustom } from "06-multi-agent-orchestrator/custom";
import { initialState, type NodeName } from "06-multi-agent-orchestrator/state";
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

export const SUITES: Record<string, Suite> = Object.fromEntries(
  [slugifyFixturesSuite, bugFixerSuite, unitTesterSuite, orchestratorSuite].map((s) => [s.name, s as Suite]),
);
