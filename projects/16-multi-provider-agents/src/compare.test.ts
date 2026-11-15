import { expect, it } from "vitest";
import { formatTable } from "./compare.js";

it("arma la tabla con costo por caso aprobado y marca el mejor pass rate", () => {
  const table = formatTable([
    { model: "openai:barato", passRate: 1, costUsd: 0.01, p50Ms: 11_700, p95Ms: 16_200, runs: 8 },
    { model: "openai:caro", passRate: 0.5, costUsd: 0.2, p50Ms: 9_500, p95Ms: 10_500, runs: 8 },
  ]);
  expect(table).toContain("| openai:barato | 100% 🏆 (8/8) | US$0.0100 | US$0.0013 | 11.7 s | 16.2 s |");
  expect(table).toContain("| openai:caro | 50% (4/8) | US$0.2000 | US$0.0500 |");
});
