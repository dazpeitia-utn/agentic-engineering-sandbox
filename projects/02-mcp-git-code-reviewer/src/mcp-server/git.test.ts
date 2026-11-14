import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitDiff, gitLog, gitRangeDiff, gitStatus, validateRef, validateRepoPath } from "./git.js";

let repo: string;

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "git-mcp-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  await fs.writeFile(path.join(repo, "a.txt"), "uno\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

describe("git tools", () => {
  it("muestra status y diff", async () => {
    expect(await gitStatus(repo)).toMatch(/limpio/);
    await fs.writeFile(path.join(repo, "a.txt"), "dos\n");
    expect(await gitStatus(repo)).toBe("M a.txt");
    expect(await gitDiff({ filePath: "a.txt" }, repo)).toMatch(/\+dos/);
  });

  it("no ejecuta comandos inyectados en filePath", async () => {
    const marker = path.join(repo, "pwned");
    await gitDiff({ filePath: `a.txt; touch ${marker}` }, repo);
    await gitDiff({ filePath: `$(touch ${marker})` }, repo);
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it("rechaza rutas que parecen flags", () => {
    expect(() => validateRepoPath("--output=/tmp/x")).toThrow(/no puede empezar/);
  });

  it("muestra diff y log entre commits", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
    const base = git("rev-parse", "HEAD");
    await fs.writeFile(path.join(repo, "a.txt"), "tres\n");
    git("commit", "-q", "-am", "cambia a");
    expect(await gitRangeDiff(base, "HEAD", repo)).toMatch(/\+tres/);
    expect(await gitLog(base, "HEAD", repo)).toMatch(/cambia a/);
  });

  it.each(["--output=/tmp/x", "HEAD..evil", "a b", "$(touch x)", ""])("rechaza refs inválidos: %j", (ref) => {
    expect(() => validateRef(ref)).toThrow(/Ref inválido/);
  });

  it("acepta refs comunes", () => {
    for (const ref of ["HEAD", "HEAD~2", "origin/main", "a1b2c3d", "v1.0.0", "feat/x-y", "main@{1}"]) {
      expect(validateRef(ref)).toBe(ref);
    }
  });
});
