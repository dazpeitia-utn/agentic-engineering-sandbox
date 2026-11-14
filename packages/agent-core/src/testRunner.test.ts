import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRunTestsTool, runVitest } from "./testRunner.js";

let root: string;

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "runner-")));
  await fs.writeFile(path.join(root, "ok.test.ts"), `import { it, expect } from "vitest"; it("suma", () => expect(1 + 1).toBe(2));`);
  await fs.writeFile(path.join(root, "bad.test.ts"), `import { it, expect } from "vitest"; it("falla", () => expect(1 + 1).toBe(3));`);
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("runVitest", () => {
  it("informa tests que pasan", async () => {
    const result = await runVitest(root, "ok.test.ts");
    expect(result.passed).toBe(true);
    expect(result.output).toMatch(/1 passed/);
  }, 60_000);

  it("informa tests que fallan con el detalle del error", async () => {
    const result = await runVitest(root, "bad.test.ts");
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/expected 2 to be 3/);
  }, 60_000);

  it("no corre archivos fuera de la carpeta", async () => {
    await expect(runVitest(root, "../otro.test.ts")).rejects.toThrow(/Acceso denegado/);
  });

  it("la tool devuelve un resumen legible", async () => {
    const tool = createRunTestsTool({ rootDir: root });
    expect(await tool.execute({ testFile: "bad.test.ts" })).toMatch(/^Resultado: FALLARON/);
  }, 60_000);
});
