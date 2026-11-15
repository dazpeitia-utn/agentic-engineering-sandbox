/**
 * Tests de los propios datasets. Un eval con un valor esperado mal calculado
 * mide mal a todos los agentes, así que los datos también se testean.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runVitest } from "@sandbox/agent-core";
import { runHiddenSpec } from "../evaluators/index.js";
import { loadFunction } from "../evaluators/module.js";
import { bugFixerCases } from "./bugFixer.js";
import { orchestratorCases } from "./orchestrator.js";
import { unitTesterCases } from "./unitTester.js";

/** Escribe archivos en una carpeta temporal dentro del monorepo (para que Vitest resuelva sus imports). */
async function workspace(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(import.meta.dirname, "../../.runs/dataset-test-"));
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), content);
  }
  return dir;
}

describe.each(bugFixerCases)("bug-fixer: $id", (c) => {
  it("el test visible falla con el bug y pasa con el parche de referencia; los chequeos ocultos pasan con el parche", async () => {
    const { sourceFile, testFile, files, referenceFix, exportName, hidden } = c.input;
    expect(files[sourceFile]).toContain(referenceFix.find);
    const buggy = await workspace(files);
    expect((await runVitest(buggy, testFile)).passed).toBe(false);

    const fixed = await workspace({ ...files, [sourceFile]: files[sourceFile].replace(referenceFix.find, referenceFix.replace) });
    expect((await runVitest(fixed, testFile)).passed).toBe(true);
    const result = await runHiddenSpec(hidden, await loadFunction(path.join(fixed, sourceFile), exportName));
    expect(result.reason).toMatch(/chequeos ocultos pasan/);
    await Promise.all([buggy, fixed].map((d) => fs.rm(d, { recursive: true, force: true })));
  }, 60_000);
});

describe.each(unitTesterCases)("unit-tester: $id", (c) => {
  it("cada mutante encuentra su texto y cambia el código", () => {
    for (const m of c.input.mutants) {
      expect(c.input.source, m.id).toContain(m.find);
      expect(c.input.source.replace(m.find, m.replace), m.id).not.toBe(c.input.source);
    }
  });
});

describe("orchestrator: los chequeos ocultos son correctos", () => {
  // Implementaciones de referencia escritas a mano: si alguna falla, el error está en el dataset.
  const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const validarCuit = (cuit: string) => {
    const digits = cuit.replace(/-/g, "");
    if (!/^\d{11}$/.test(digits) || !["20", "23", "24", "27", "30", "33", "34"].includes(digits.slice(0, 2))) return false;
    const r = 11 - (WEIGHTS.reduce((a, w, i) => a + w * Number(digits[i]), 0) % 11);
    const dv = r === 11 ? 0 : r;
    return r !== 10 && dv === Number(digits[10]);
  };
  const formatearBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error("inválido");
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return i === 0 ? `${value} B` : `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[i]}`;
  };
  const refs: Record<string, (...a: any[]) => any> = { validarCuit, formatearBytes };

  it.each(orchestratorCases.filter((c) => c.input.hidden.kind === "checks"))("$id", async (c) => {
    const result = await runHiddenSpec(c.input.hidden, refs[c.input.exportName]);
    expect(result.reason).toMatch(/chequeos ocultos pasan/);
  });
});

it("la carpeta temporal del sistema no se usa (Vitest necesita estar dentro del monorepo)", () => {
  expect(import.meta.dirname.startsWith(os.tmpdir())).toBe(false);
});
