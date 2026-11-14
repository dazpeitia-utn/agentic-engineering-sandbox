import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsTools, resolveInside } from "./fsTools.js";

let root: string;
let outside: string;

beforeEach(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-core-")));
  root = path.join(base, "project");
  outside = path.join(base, "outside");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;");
  await fs.writeFile(path.join(outside, "secret.txt"), "secreto");
});

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("acepta rutas dentro de la carpeta", async () => {
    expect(await resolveInside(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"));
    expect(await resolveInside(root, "src/nuevo/b.ts")).toBe(path.join(root, "src", "nuevo", "b.ts"));
  });

  it.each(["../outside/secret.txt", "/etc/passwd", "src/../../outside/secret.txt"])("rechaza %s", async (p) => {
    await expect(resolveInside(root, p)).rejects.toThrow(/Acceso denegado/);
  });

  it("rechaza symlinks que apuntan afuera", async () => {
    await fs.symlink(outside, path.join(root, "link"));
    await expect(resolveInside(root, "link/secret.txt")).rejects.toThrow(/Acceso denegado/);
    await expect(resolveInside(root, "link/nuevo.txt")).rejects.toThrow(/Acceso denegado/);
  });
});

describe("createFsTools", () => {
  it("lee y escribe dentro de la carpeta", async () => {
    const [read, write] = createFsTools({ rootDir: root });
    expect(await read.execute({ filePath: "src/a.ts" })).toBe("export const a = 1;");
    await write.execute({ filePath: "src/b.ts", content: "b" });
    expect(await fs.readFile(path.join(root, "src", "b.ts"), "utf-8")).toBe("b");
  });

  it("no escribe fuera de la carpeta", async () => {
    const [, write] = createFsTools({ rootDir: root });
    await expect(write.execute({ filePath: "../outside/pwn.txt", content: "x" })).rejects.toThrow(/Acceso denegado/);
  });

  it("con allowWrite=false solo expone read_file", () => {
    expect(createFsTools({ rootDir: root, allowWrite: false }).map((t) => t.name)).toEqual(["read_file"]);
  });

  it("rechaza archivos más grandes que maxReadBytes", async () => {
    const [read] = createFsTools({ rootDir: root, maxReadBytes: 5 });
    await expect(read.execute({ filePath: "src/a.ts" })).rejects.toThrow(/supera el límite/);
  });
});
