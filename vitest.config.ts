import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      // Fixture del proyecto 04: falla a propósito hasta que el agente arregla el bug.
      "projects/04-autonomous-bug-fixer/src/buggyCode.test.ts",
      // Código y tests generados por los agentes del proyecto 06 en cada corrida.
      "projects/06-multi-agent-orchestrator/workspace/**",
      // Código y tests generados por los agentes durante los evals (proyecto 08).
      "projects/08-eval-harness/.runs/**",
    ],
  },
});
