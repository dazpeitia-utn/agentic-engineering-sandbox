import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitDiff, gitStatus, validateRepoPath } from "./git.js";

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
});
