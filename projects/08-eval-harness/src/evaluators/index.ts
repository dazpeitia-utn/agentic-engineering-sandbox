import { generateStructured } from "@sandbox/agent-core";
import type { CaseContext, EvalCase, Evaluator, Score } from "../core/types.js";
import { loadFunction } from "./module.js";
import { checkSlugifyProperties } from "./slugifyProperties.js";

/** Un chequeo oculto: el agente nunca lo ve, así no puede "sobreajustar" a él. */
export interface HiddenCheck {
  description: string;
  /** Recibe la función bajo prueba; debe lanzar (ej: con node:assert) si falla. */
  run(fn: (...args: any[]) => any): void | Promise<void>;
}

/** Cómo verificar un módulo generado: chequeos ocultos o las propiedades de slugify. */
export type HiddenSpec = { kind: "checks"; checks: HiddenCheck[] } | { kind: "slugify-properties" };

/** Corre los chequeos ocultos sobre una función. Puntaje = proporción de chequeos que pasan. */
export async function runHiddenSpec(spec: HiddenSpec, fn: (...args: any[]) => any): Promise<Omit<Score, "evaluator">> {
  if (spec.kind === "slugify-properties") {
    const results = checkSlugifyProperties(fn);
    const failed = results.filter((r) => !r.passed);
    return {
      score: (results.length - failed.length) / results.length,
      pass: failed.length === 0,
      reason: failed.length === 0
        ? `${results.length}/${results.length} propiedades se cumplen en 400 entradas generadas`
        : failed.map((f) => `${f.property}: con ${JSON.stringify(f.counterexample)} devolvió ${f.got}${f.expected ? `, se esperaba ${f.expected}` : ""}`).join(" | "),
      details: { properties: results },
    };
  }

  const failures: string[] = [];
  for (const check of spec.checks) {
    try {
      await check.run(fn);
    } catch (e: any) {
      failures.push(`${check.description} (${String(e?.message ?? e).split("\n")[0].slice(0, 120)})`);
    }
  }
  const passed = spec.checks.length - failures.length;
  return {
    score: passed / spec.checks.length,
    pass: failures.length === 0,
    reason: failures.length === 0 ? `${passed}/${spec.checks.length} chequeos ocultos pasan` : `Fallan ${failures.length}/${spec.checks.length}: ${failures.join(" | ")}`,
  };
}

/** Evaluador genérico: importa la función del módulo que produjo el target y corre su spec oculto. */
export function hiddenSpecEvaluator<I extends { exportName: string; hidden: HiddenSpec }, O extends { moduleFile: string | null }>(
  name = "hidden_checks",
): Evaluator<I, O> {
  return {
    name,
    async evaluate(evalCase, output) {
      if (!output.moduleFile) return { evaluator: name, score: 0, pass: false, reason: "El agente no produjo el módulo." };
      const fn = await loadFunction(output.moduleFile, evalCase.input.exportName);
      return { evaluator: name, ...(await runHiddenSpec(evalCase.input.hidden, fn)) };
    },
  };
}

/**
 * LLM-as-judge con rúbrica. Por default NO es decisivo (gating: false): el
 * harness mide cuánto coincide con los evaluadores determinísticos, que es la
 * forma de saber si se puede confiar en él.
 */
export function llmJudge<I, O>({
  name = "llm_judge",
  rubric,
  prompt,
  gating = false,
}: {
  name?: string;
  rubric: string;
  prompt: (evalCase: EvalCase<I>, output: O) => string | Promise<string>;
  gating?: boolean;
}): Evaluator<I, O> {
  return {
    name,
    gating,
    async evaluate(evalCase, output, ctx: CaseContext) {
      const verdict = await generateStructured<{ score: number; pass: boolean; reasoning: string }>({
        client: ctx.client,
        model: ctx.model,
        name: "judge",
        schema: {
          type: "object",
          properties: {
            reasoning: { type: "string", description: "Razonamiento breve, antes del puntaje." },
            score: { type: "integer", description: "1 (muy mal) a 5 (excelente)" },
            pass: { type: "boolean" },
          },
          required: ["reasoning", "score", "pass"],
          additionalProperties: false,
        },
        system: `Eres un evaluador estricto de software. Rúbrica:\n${rubric}\nRazona primero, después asigna el puntaje. pass=true solo si el puntaje es 4 o 5.`,
        user: await prompt(evalCase, output),
      });
      const score = Math.min(5, Math.max(1, verdict.score));
      return { evaluator: name, score: (score - 1) / 4, pass: verdict.pass, reason: `${score}/5: ${verdict.reasoning}` };
    },
  };
}
