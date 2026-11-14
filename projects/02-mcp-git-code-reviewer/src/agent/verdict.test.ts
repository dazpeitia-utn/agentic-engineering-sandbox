import { describe, expect, it } from "vitest";
import { isNewBranch, parsePrePushInput, parseVerdict } from "./verdict.js";

describe("parseVerdict", () => {
  it.each([
    ["Todo bien.\nVEREDICTO: APROBADO", "approved"],
    ["Hay una inyección SQL.\n**VEREDICTO: BLOQUEAR**", "blocked"],
    ["veredicto: aprobado", "approved"],
    ["Sin línea final", "unknown"],
  ])("%j → %s", (review, expected) => {
    expect(parseVerdict(review)).toBe(expected);
  });

  it("usa el último veredicto si hay varios", () => {
    expect(parseVerdict("Formato: VEREDICTO: APROBADO o BLOQUEAR...\nVEREDICTO: BLOQUEAR")).toBe("blocked");
  });
});

describe("parsePrePushInput", () => {
  const sha = (c: string) => c.repeat(40);

  it("parsea refs y omite borrados de ramas", () => {
    const input = [
      `refs/heads/feat ${sha("a")} refs/heads/feat ${sha("b")}`,
      `(delete) ${sha("0")} refs/heads/vieja ${sha("c")}`,
      `refs/heads/nueva ${sha("d")} refs/heads/nueva ${sha("0")}`,
      "",
    ].join("\n");
    const refs = parsePrePushInput(input);
    expect(refs.map((r) => r.localRef)).toEqual(["refs/heads/feat", "refs/heads/nueva"]);
    expect(refs.map(isNewBranch)).toEqual([false, true]);
  });
});
