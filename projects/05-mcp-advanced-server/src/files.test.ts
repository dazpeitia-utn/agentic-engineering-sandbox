import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMonorepoInfo, readProjectFile } from "./files.js";

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mcp05-")));
  await fs.mkdir(path.join(root, "projects", "01-a", "src"), { recursive: true });
  await fs.mkdir(path.join(root, "projects", "02-b"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "core"), { recursive: true });
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mono", version: "1.2.3" }));
  await fs.writeFile(path.join(root, "projects", "01-a", "src", "x.ts"), "export {}");
  await fs.writeFile(path.join(root, ".env"), "OPENAI_API_KEY=secreto");
  await fs.writeFile(path.join(root, "projects", "01-a", ".env.local"), "X=1");
  await fs.writeFile(path.join(root, ".env.example"), "OPENAI_API_KEY=");
  await fs.writeFile(path.join(root, ".git", "config"), "[core]");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("readProjectFile", () => {
  it("lee archivos del monorepo", async () => {
    expect(await readProjectFile(root, "projects/01-a/src/x.ts")).toBe("export {}");
    expect(await readProjectFile(root, ".env.example")).toBe("OPENAI_API_KEY=");
  });

  it.each([".env", "projects/01-a/.env.local"])("bloquea secretos: %s", async (p) => {
    await expect(readProjectFile(root, p)).rejects.toThrow(/secretos/);
  });

  it("bloquea .git", async () => {
    await expect(readProjectFile(root, ".git/config")).rejects.toThrow(/bloqueada/);
  });

  it.each(["../../etc/passwd", "/etc/passwd"])("bloquea rutas fuera del monorepo: %s", async (p) => {
    await expect(readProjectFile(root, p)).rejects.toThrow(/Acceso denegado/);
  });
});

describe("getMonorepoInfo", () => {
  it("cuenta los proyectos reales", async () => {
    expect(await getMonorepoInfo(root)).toMatchObject({
      name: "mono",
      version: "1.2.3",
      activeProjects: 2,
      projects: ["01-a", "02-b"],
      packages: ["core"],
    });
  });
});
