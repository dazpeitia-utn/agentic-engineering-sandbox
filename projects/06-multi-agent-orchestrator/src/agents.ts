import fs from "node:fs/promises";
import path from "node:path";
import {
  consoleLogger,
  createFsTools,
  createRunTestsTool,
  generateStructured,
  runAgent,
  runVitest,
  type ChatClient,
} from "@sandbox/agent-core";
import { NODES, type Agents, type NodeName, type OrchestratorState, type Plan, type Review } from "./state.js";

export interface AgentDeps {
  client: ChatClient;
  model: string;
  /** Carpeta aislada de la corrida: los agentes solo pueden tocar archivos acá. */
  workspaceDir: string;
  verbose?: boolean;
  /**
   * Instrucciones extra por agente, que se agregan al final de su system prompt.
   * Sirven para comparar variantes de prompts con el eval harness (proyecto 08).
   */
  instructions?: Partial<Record<NodeName, string>>;
}

// Un único archivo dentro de src/, sin subcarpetas ni `..`. Acepta camelCase (src/validarCuit.ts): el eval 08 detectó que antes lo rechazaba.
const MODULE_PATH = /^src\/[A-Za-z][A-Za-z0-9_-]*\.ts$/;

const planSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sourceFile: { type: "string", description: "Ruta del módulo, con el formato src/<nombre>.ts" },
    testFile: { type: "string", description: "Ruta de los tests, con el formato src/<nombre>.test.ts" },
    exports: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, signature: { type: "string" }, description: { type: "string" } },
        required: ["name", "signature", "description"],
        additionalProperties: false,
      },
    },
    testCases: { type: "array", items: { type: "string" } },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "sourceFile", "testFile", "exports", "testCases", "acceptanceCriteria"],
  additionalProperties: false,
};

const reviewSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    summary: { type: "string" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["approved", "summary", "issues"],
  additionalProperties: false,
};

/** Valida el plan del arquitecto: las rutas las usa el sandbox, no pueden ser cualquier cosa. */
export function validatePlan(plan: Plan): Plan {
  if (!MODULE_PATH.test(plan.sourceFile)) throw new Error(`sourceFile inválido: "${plan.sourceFile}"`);
  if (plan.testFile !== plan.sourceFile.replace(/\.ts$/, ".test.ts")) throw new Error(`testFile inválido: "${plan.testFile}"`);
  if (plan.exports.length === 0 || plan.testCases.length === 0) throw new Error("El plan no tiene exports o casos de prueba.");
  return plan;
}

const describePlan = (plan: Plan) =>
  [
    `Resumen: ${plan.summary}`,
    `Módulo: ${plan.sourceFile} | Tests: ${plan.testFile}`,
    "API:",
    ...plan.exports.map((e) => `- ${e.signature}: ${e.description}`),
    "Casos de prueba:",
    ...plan.testCases.map((c) => `- ${c}`),
    "Criterios de aceptación:",
    ...plan.acceptanceCriteria.map((c) => `- ${c}`),
  ].join("\n");

const ESM_NOTE = "El proyecto usa TypeScript ESM (NodeNext): los imports relativos terminan en .js, ej: import { f } from './modulo.js'.";

/** Crea los cinco nodos del orquestador. Son funciones comunes: sirven para cualquier motor de grafos. */
export function createAgents({ client, model, workspaceDir, verbose = true, instructions = {} }: AgentDeps): Agents {
  const extra = (node: NodeName) => (instructions[node] ? `\n\n${instructions[node]}` : "");
  const onEvent = (prefix: string) => (verbose ? consoleLogger(prefix) : undefined);
  const readWorkspace = (file: string) => fs.readFile(path.join(workspaceDir, file), "utf-8").catch(() => "(no existe)");

  return {
    /** Arquitecto: convierte la tarea en un plan estructurado. No escribe archivos. */
    async [NODES.architect](state) {
      const plan = validatePlan(
        await generateStructured<Plan>({
          client,
          model,
          name: "plan",
          schema: planSchema,
          system:
            "Eres un Arquitecto de Software. Diseña un único módulo TypeScript para la tarea: su API pública, " +
            "los casos de prueba (incluyendo bordes y errores) y los criterios de aceptación. " +
            "Usa rutas src/<nombre>.ts y src/<nombre>.test.ts. Sin dependencias externas." + extra(NODES.architect),
          user: `Tarea: ${state.task}`,
        }),
      );
      return { plan, log: [`🏛️ arquitecto: plan para ${plan.sourceFile} con ${plan.testCases.length} casos de prueba`] };
    },

    /** Tester: escribe los tests ANTES que el código (TDD). Solo puede escribir el archivo de tests. */
    async [NODES.tester](state) {
      const plan = state.plan!;
      await runAgent({
        client,
        model,
        system:
          "Eres un Ingeniero de QA. Escribe tests con Vitest a partir de la especificación, antes de que exista la implementación. " +
          `Cubre todos los casos de prueba del plan. ${ESM_NOTE} Escribe el archivo con write_file y termina.` + extra(NODES.tester),
        user: `Especificación:\n${describePlan(plan)}\n\nEscribe ${plan.testFile}.`,
        tools: createFsTools({ rootDir: workspaceDir, canWrite: (p) => p === plan.testFile, writeDeniedMessage: `Solo puedes escribir ${plan.testFile}.` }),
        maxIterations: 4,
        onEvent: onEvent("🧪"),
      });
      const written = await readWorkspace(plan.testFile);
      if (written === "(no existe)") throw new Error(`El tester no escribió ${plan.testFile}.`);
      return { log: [`🧪 tester: escribió ${plan.testFile}`] };
    },

    /** Desarrollador: implementa el módulo para que pasen los tests. No puede tocar los tests. */
    async [NODES.developer](state) {
      const plan = state.plan!;
      const feedback = [
        state.testReport && !state.testReport.passed ? `Los tests fallaron. Salida de Vitest:\n${state.testReport.output}` : "",
        state.review && !state.review.approved ? `El revisor pidió cambios:\n${state.review.issues.map((i) => `- ${i}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");

      const result = await runAgent({
        client,
        model,
        system:
          "Eres un Desarrollador TypeScript. Implementa el módulo según el plan para que pasen los tests existentes. " +
          `Lee el archivo de tests con read_file, escribe la implementación completa con write_file y verifica con run_tests. ${ESM_NOTE} ` +
          "No puedes modificar los tests." + extra(NODES.developer),
        user: `Plan:\n${describePlan(plan)}${feedback ? `\n\n${feedback}` : ""}`,
        tools: [
          ...createFsTools({ rootDir: workspaceDir, canWrite: (p) => p === plan.sourceFile, writeDeniedMessage: `Solo puedes escribir ${plan.sourceFile}.` }),
          createRunTestsTool({ rootDir: workspaceDir }),
        ],
        maxIterations: 8,
        onEvent: onEvent("💻"),
      });
      const attempts = state.attempts + 1;
      return { attempts, log: [`💻 desarrollador (intento ${attempts}): ${result.stoppedReason === "completed" ? "terminó" : "se quedó sin iteraciones"}`] };
    },

    /** Ejecutar tests: nodo determinístico, sin LLM. Es la fuente de verdad para el routing. */
    async [NODES.runTests](state) {
      const result = await runVitest(workspaceDir, state.plan!.testFile);
      const passedLine = result.output.match(/Tests\s+.*$/m)?.[0] ?? (result.passed ? "pasan" : "fallan");
      return { testReport: { passed: result.passed, output: result.output }, log: [`▶️ tests: ${result.passed ? "✅" : "❌"} ${passedLine.trim()}`] };
    },

    /** Revisor: lee código, tests y resultado, y da un veredicto estructurado. */
    async [NODES.reviewer](state) {
      const plan = state.plan!;
      const review = await generateStructured<Review>({
        client,
        model,
        name: "review",
        schema: reviewSchema,
        system:
          "Eres un Revisor de Código Senior. Evalúa si la implementación cumple el plan y los criterios de aceptación, " +
          "si los tests son adecuados y si hay bugs o problemas de calidad. Aprueba solo si los tests pasan y no hay problemas importantes. " +
          "Las sugerencias menores no impiden aprobar." + extra(NODES.reviewer),
        user: [
          `Plan:\n${describePlan(plan)}`,
          `Código (${plan.sourceFile}):\n${await readWorkspace(plan.sourceFile)}`,
          `Tests (${plan.testFile}):\n${await readWorkspace(plan.testFile)}`,
          `Resultado de los tests: ${state.testReport?.passed ? "PASAN" : "FALLAN"}\n${state.testReport?.output.slice(-3000) ?? ""}`,
        ].join("\n\n"),
      });
      return { review, log: [`🔎 revisor: ${review.approved ? "✅ aprobado" : `❌ ${review.issues.length} observaciones`}`] };
    },
  };
}
