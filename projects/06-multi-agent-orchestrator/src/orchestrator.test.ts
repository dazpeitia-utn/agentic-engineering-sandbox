import { describe, expect, it } from "vitest";
import { MemoryCheckpointer } from "@sandbox/agent-core";
import { validatePlan } from "./agents.js";
import { runCustom } from "./custom/orchestrator.js";
import { runLangGraph } from "./langgraph/orchestrator.js";
import { routeAfterReview, routeAfterTests } from "./routing.js";
import { initialState, type Agents, type OrchestratorState, type Plan } from "./state.js";

const plan: Plan = {
  summary: "s",
  sourceFile: "src/slugify.ts",
  testFile: "src/slugify.test.ts",
  exports: [{ name: "slugify", signature: "slugify(t: string): string", description: "d" }],
  testCases: ["caso"],
  acceptanceCriteria: ["criterio"],
};

/**
 * Agentes falsos con un guion: `testResults` dice si los tests pasan en cada
 * ejecución y `reviews` si el revisor aprueba en cada revisión.
 */
function scriptedAgents(testResults: boolean[], reviews: boolean[]): Agents {
  const tests = [...testResults];
  const verdicts = [...reviews];
  return {
    architect: async () => ({ plan, log: ["architect"] }),
    tester: async () => ({ log: ["tester"] }),
    developer: async (s) => ({ attempts: s.attempts + 1, log: [`developer#${s.attempts + 1}`] }),
    run_tests: async () => {
      const passed = tests.shift() ?? false;
      return { testReport: { passed, output: passed ? "ok" : "fail" }, log: [`tests:${passed}`] };
    },
    reviewer: async () => {
      const approved = verdicts.shift() ?? false;
      return { review: { approved, summary: "", issues: approved ? [] : ["arreglar"] }, log: [`review:${approved}`] };
    },
  };
}

const engines = {
  custom: (agents: Agents, max: number) => runCustom(agents, initialState("t"), { maxAttempts: max, threadId: "t1", checkpointer: new MemoryCheckpointer<OrchestratorState>() }),
  langgraph: (agents: Agents, max: number) => runLangGraph(agents, initialState("t"), { maxAttempts: max, threadId: "t1" }),
};

describe.each(Object.entries(engines))("motor %s", (_name, run) => {
  it("camino feliz: tests pasan y el revisor aprueba", async () => {
    const { steps, state } = await run(scriptedAgents([true], [true]), 3);
    expect(steps).toEqual(["architect", "tester", "developer", "run_tests", "reviewer"]);
    expect(state.log).toEqual(["architect", "tester", "developer#1", "tests:true", "review:true"]);
  });

  it("si los tests fallan vuelve al desarrollador", async () => {
    const { steps, state } = await run(scriptedAgents([false, true], [true]), 3);
    expect(steps).toEqual(["architect", "tester", "developer", "run_tests", "developer", "run_tests", "reviewer"]);
    expect(state.attempts).toBe(2);
  });

  it("si el revisor rechaza, el desarrollador corrige y se revisa de nuevo", async () => {
    const { steps } = await run(scriptedAgents([true, true], [false, true]), 3);
    expect(steps).toEqual(["architect", "tester", "developer", "run_tests", "reviewer", "developer", "run_tests", "reviewer"]);
  });

  it("respeta el máximo de intentos y termina sin aprobar", async () => {
    const { steps, state } = await run(scriptedAgents([false, false], []), 2);
    expect(steps.filter((s) => s === "developer")).toHaveLength(2);
    expect(steps.at(-1)).toBe("reviewer");
    expect(state.review?.approved).toBe(false);
  });
});

describe("ambos motores son equivalentes", () => {
  it.each([
    [[true], [true]],
    [[false, false, true], [false, true]],
    [[false, false, false], []],
  ])("tests=%j reviews=%j", async (tests, reviews) => {
    const custom = await engines.custom(scriptedAgents(tests, reviews), 3);
    const langgraph = await engines.langgraph(scriptedAgents(tests, reviews), 3);
    expect(langgraph.steps).toEqual(custom.steps);
    expect(langgraph.state).toEqual(custom.state);
  });
});

describe("routing", () => {
  const state = (passed: boolean | null, approved: boolean | null, attempts: number): OrchestratorState => ({
    ...initialState("t"),
    attempts,
    testReport: passed === null ? null : { passed, output: "" },
    review: approved === null ? null : { approved, summary: "", issues: [] },
  });

  it("después de los tests", () => {
    expect(routeAfterTests(state(true, null, 1), 3)).toBe("reviewer");
    expect(routeAfterTests(state(false, null, 1), 3)).toBe("developer");
    expect(routeAfterTests(state(false, null, 3), 3)).toBe("reviewer");
  });

  it("después de la revisión", () => {
    expect(routeAfterReview(state(true, true, 1), 3)).toBe("end");
    expect(routeAfterReview(state(true, false, 1), 3)).toBe("developer");
    expect(routeAfterReview(state(false, false, 3), 3)).toBe("end");
  });
});

describe("validatePlan", () => {
  it("acepta un plan correcto", () => expect(validatePlan(plan)).toBe(plan));
  it.each([
    { sourceFile: "../escape.ts", testFile: "../escape.test.ts" },
    { sourceFile: "/etc/x.ts", testFile: "/etc/x.test.ts" },
    { sourceFile: "src/a.ts", testFile: "src/otro.test.ts" },
  ])("rechaza rutas peligrosas o inconsistentes: %j", (paths) => {
    expect(() => validatePlan({ ...plan, ...paths })).toThrow(/inválido/);
  });
});
