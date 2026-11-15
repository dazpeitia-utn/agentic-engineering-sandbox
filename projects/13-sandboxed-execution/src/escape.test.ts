/**
 * Tests de escape contra Docker REAL: simulan lo que haría código hostil (escrito por
 * un LLM comprometido) e intentan salir del sandbox. Se saltean si no hay daemon de
 * Docker o si falta la imagen (npm run build-image -w 13-sandboxed-execution).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dockerAvailable, runInSandbox, runVitestInSandbox, SANDBOX_IMAGE, execFileAsync } from "@sandbox/agent-core";

const ready = (await dockerAvailable()) && (await execFileAsync("docker", ["image", "inspect", SANDBOX_IMAGE], { timeout: 5000 })).code === 0;
let ws: string;

beforeAll(async () => {
  ws = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sbx-")));
  await fs.chmod(ws, 0o777);
});
afterAll(async () => {
  if (ws) await fs.rm(ws, { recursive: true, force: true });
});

const sh = (script: string, opts = {}) => runInSandbox(["sh", "-c", script], { workspaceDir: ws, timeoutMs: 30_000, ...opts });

describe.skipIf(!ready)("escape del sandbox (Docker real)", () => {
  it("no hay red: no se puede exfiltrar ni descargar", async () => {
    const r = await runInSandbox(["node", "-e", "fetch('https://example.com').then(()=>console.log('CONECTO')).catch(e=>console.log('BLOQUEADO', e.cause?.code ?? e.message))"], { workspaceDir: ws });
    expect(r.stdout).toContain("BLOQUEADO");
    expect(r.stdout).not.toContain("CONECTO");
  });

  it("no ve los secretos del host", async () => {
    process.env.OPENAI_API_KEY_TEST_ESCAPE = "sk-esto-no-deberia-verse";
    const r = await sh("env");
    expect(r.stdout).not.toContain("sk-esto-no-deberia-verse");
    expect(r.stdout).not.toMatch(/OPENAI_API_KEY/);
  });

  it("no puede escribir fuera de /workspace ni leer el filesystem del host", async () => {
    const r = await sh("touch /etc/pwned 2>&1; touch /usr/pwned 2>&1; ls /Users 2>&1; echo ok > /workspace/permitido.txt; cat /workspace/permitido.txt");
    expect(r.stdout).toMatch(/Read-only file system/);
    expect(r.stdout).toMatch(/No such file or directory/);
    expect(await fs.readFile(path.join(ws, "permitido.txt"), "utf-8")).toBe("ok\n");
  });

  it("no es root y no tiene capabilities", async () => {
    const r = await sh("id -u; grep CapEff /proc/self/status");
    expect(r.stdout).toMatch(/^1000\n/);
    expect(r.stdout).toMatch(/CapEff:\s+0000000000000000/);
  });

  it("el límite de memoria corta un proceso que intenta usar 1 GB", async () => {
    const r = await runInSandbox(["node", "-e", "const a=[];while(true){a.push(Buffer.alloc(50*1024*1024,1))}"], { workspaceDir: ws, memory: "256m" });
    expect(r.exitCode).not.toBe(0);
    expect(r.oomKilled || /heap|memory/i.test(r.stderr)).toBe(true);
  });

  it("una fork bomb queda contenida por el límite de procesos", async () => {
    // Node intenta crear 400 procesos con un límite de 64 y cuenta cuántos pudo crear.
    // (Se mide con Node porque, con el límite agotado, un shell ni siquiera puede crear
    // el subproceso de un $(...) para informar: ver el test siguiente.)
    const bomb = `
      const { spawn } = require("child_process");
      const limite = require("fs").readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim();
      let ok = 0, fallos = 0, pendientes = 400;
      const fin = () => { if (--pendientes === 0) { console.log("limite=" + limite + " creados=" + ok + " fallos=" + fallos); process.exit(0); } };
      for (let i = 0; i < 400; i++) {
        const c = spawn("sleep", ["30"], { stdio: "ignore" });
        c.on("spawn", () => { ok++; fin(); });
        c.on("error", () => { fallos++; fin(); });
      }`;
    const r = await runInSandbox(["node", "-e", bomb], { workspaceDir: ws, pidsLimit: 64, timeoutMs: 20_000 });
    const [, limite, creados, fallos] = r.stdout.match(/limite=(\d+) creados=(\d+) fallos=(\d+)/)!.map(Number);
    expect(limite).toBe(64);
    // Los hilos del propio Node también cuentan: se crean menos de 64 procesos.
    expect(creados).toBeLessThan(64);
    expect(creados + fallos).toBe(400);
    expect(r.durationMs).toBeLessThan(15_000);
  }, 30_000);

  it("un shell que agota el límite de procesos aborta (el atacante muere, el host no se entera)", async () => {
    const r = await sh("i=0; while [ $i -lt 400 ]; do sleep 30 >/dev/null 2>&1 & i=$((i+1)); done; echo nunca-llega", { pidsLimit: 64, timeoutMs: 20_000 });
    expect(r.stderr).toMatch(/Cannot fork/);
    expect(r.stdout).not.toContain("nunca-llega");
    expect(r.durationMs).toBeLessThan(15_000);
  }, 30_000);

  it("un loop infinito se corta por timeout y el contenedor no queda vivo", async () => {
    const r = await runInSandbox(["node", "-e", "while(true){}"], { workspaceDir: ws, timeoutMs: 3000 });
    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(15_000);
    const vivos = await execFileAsync("docker", ["ps", "-q", "--filter", "name=agent-sbx"], { timeout: 5000 });
    expect(vivos.stdout.trim()).toBe("");
  }, 30_000);

  it("vitest funciona adentro: un test generado corre aislado", async () => {
    await fs.writeFile(path.join(ws, "suma.test.ts"), 'import { it, expect } from "vitest";\nit("suma", () => expect(1 + 1).toBe(2));\n');
    const r = await runVitestInSandbox(ws, "suma.test.ts");
    expect(r.passed).toBe(true);
    // Sin códigos de color: la salida la lee un LLM.
    expect(r.output).not.toMatch(/\x1b\[/);
    expect(r.output).toMatch(/1 passed/);
  }, 60_000);
});

it("informa si los tests de escape se saltearon", () => {
  if (!ready) console.warn("⚠️ Tests de escape salteados: Docker no está corriendo o falta la imagen (npm run build-image -w 13-sandboxed-execution).");
  expect(true).toBe(true);
});
