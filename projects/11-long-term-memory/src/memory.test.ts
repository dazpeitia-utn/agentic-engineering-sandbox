import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { containsSensitive, writeMemories } from "./session.js";
import { MemoryStore, type Embedder } from "./store.js";

/** Embedder falso determinístico: bolsa de palabras (sin acentos) en 64 dimensiones. */
const embed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Array(64).fill(0);
    for (const w of t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\W+/).filter((x) => x.length > 2)) {
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 64;
      v[h] += 1;
    }
    return v;
  });

let file: string;
let now: Date;
const open = () => MemoryStore.open(file, embed, () => now);
const base = { type: "semantic" as const, importance: 3, ttlDays: null, sourceSession: "s1" };

beforeEach(async () => {
  file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "mem-")), "memories.json");
  now = new Date("2026-01-01T00:00:00Z");
});

describe("MemoryStore", () => {
  it("persiste entre aperturas (sesiones distintas)", async () => {
    const a = await open();
    await a.add({ ...base, subject: "lenguaje", content: "El usuario programa en TypeScript" });
    await a.save();
    const b = await open();
    expect(b.all().map((m) => m.content)).toEqual(["El usuario programa en TypeScript"]);
  });

  it("ordena por relevancia (aunque otra memoria sea más importante) y minRelevance filtra", async () => {
    const s = await open();
    await s.add({ ...base, subject: "lenguaje", content: "El usuario programa en TypeScript" });
    await s.add({ ...base, subject: "mascota", content: "El usuario tiene un perro llamado Rayo", importance: 5 });
    await s.add({ ...base, subject: "comida", content: "Odia el brócoli hervido" });
    const results = await s.search("¿en qué lenguaje programa el usuario? TypeScript");
    expect(results[0].content).toContain("TypeScript");
    expect(results.at(-1)?.subject).not.toBe("lenguaje");
    expect((await s.search("¿en qué lenguaje programa el usuario? TypeScript", { minRelevance: 0.5 })).map((r) => r.subject)).toEqual(["lenguaje"]);
  });

  it("en una pregunta con dos temas trae las dos memorias", async () => {
    const s = await open();
    await s.add({ ...base, subject: "lenguaje", content: "Programa en TypeScript con mucho entusiasmo y experiencia" });
    await s.add({ ...base, subject: "ciudad", content: "Vive en Rosario" });
    const subjects = (await s.search("¿Dónde vive y en qué lenguaje programa con experiencia?")).map((r) => r.subject);
    expect(subjects).toEqual(expect.arrayContaining(["lenguaje", "ciudad"]));
  });

  it("a igual relevancia, gana la más importante y la más reciente", async () => {
    const s = await open();
    const vieja = await s.add({ ...base, subject: "editor", content: "usa el editor vim", importance: 2 });
    now = new Date("2026-03-01T00:00:00Z");
    await s.add({ ...base, subject: "editor", content: "usa el editor vim", importance: 5 });
    const [first] = await s.search("qué editor usa vim", { markAccessed: false });
    expect(first.id).not.toBe(vieja.id);
  });

  it("las memorias temporales vencen y se pueden purgar", async () => {
    const s = await open();
    await s.add({ ...base, subject: "vacaciones", content: "Está de vacaciones esta semana", ttlDays: 7 });
    expect(s.all()).toHaveLength(1);
    now = new Date("2026-01-09T00:00:00Z");
    expect(s.all()).toHaveLength(0);
    expect(await s.search("vacaciones")).toEqual([]);
    expect(s.purgeExpired()).toBe(1);
  });

  it("update guarda la versión anterior", async () => {
    const s = await open();
    const m = await s.add({ ...base, subject: "ciudad", content: "Vive en Córdoba" });
    await s.update(m.id, "Vive en Rosario");
    expect(s.get(m.id)).toMatchObject({ content: "Vive en Rosario", history: [{ content: "Vive en Córdoba" }] });
  });
});

describe("privacidad", () => {
  it("detecta secretos y tarjetas, pero no texto normal", () => {
    expect(containsSensitive("su contraseña: SuperSecreta123")).toContain("credential_assignment");
    expect(containsSensitive("tarjeta 4111 1111 1111 1111")).toContain("credit_card");
    expect(containsSensitive("programa en TypeScript y vive en Rosario")).toEqual([]);
  });
});

describe("writeMemories (LLM falso)", () => {
  const llm = (replies: object[]) => {
    const queue = replies.map((r) => JSON.stringify(r));
    return { chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: queue.shift() } }] }) as any) } } };
  };
  const transcript = [{ role: "user" as const, content: "x" }];

  it("agrega, actualiza en vez de duplicar, y descarta lo sensible sin mandarlo a reconciliar", async () => {
    const s = await open();
    const ciudad = await s.add({ ...base, subject: "ciudad", content: "Vive en Córdoba" });
    const client = llm([
      {
        memories: [
          { type: "semantic", subject: "ciudad", content: "Vive en Rosario", importance: 4, ttlDays: null },
          { type: "procedural", subject: "estilo de respuesta", content: "Prefiere respuestas cortas", importance: 3, ttlDays: null },
          { type: "semantic", subject: "banco", content: "Su contraseña del banco es: Hunter2!!xyz", importance: 5, ttlDays: null },
        ],
        forget: [],
      },
      {
        operations: [
          { op: "update", candidate: 0, targetId: ciudad.id, content: "Vive en Rosario (antes en Córdoba)", reason: "se mudó" },
          { op: "add", candidate: 1, targetId: null, content: null, reason: "nuevo" },
        ],
      },
    ]);
    const report = await writeMemories(s, transcript, "s2", { client, model: "m" });
    expect(report).toMatchObject({ updated: [ciudad.id], added: [expect.any(String)], skipped: [{ reason: "dato sensible" }] });
    expect(s.all().map((m) => m.content).sort()).toEqual(["Prefiere respuestas cortas", "Vive en Rosario (antes en Córdoba)"]);
    // La contraseña nunca llegó al prompt de reconciliación.
    const secondPrompt = (client.chat.completions.create.mock.calls[1] as any)[0].messages[1].content;
    expect(secondPrompt).not.toContain("Hunter2");
    expect(JSON.stringify(await fs.readFile(file, "utf-8"))).not.toContain("Hunter2");
  });

  it("un hecho con el mismo tema nunca se duplica: si el LLM dice add, se actualiza", async () => {
    const s = await open();
    const ciudad = await s.add({ ...base, subject: "ciudad", content: "Vive en Córdoba" });
    const client = llm([
      { memories: [{ type: "semantic", subject: "Ciudad", content: "Vive en Rosario", importance: 4, ttlDays: null }], forget: [] },
      { operations: [{ op: "add", candidate: 0, targetId: null, content: null, reason: "el LLM se equivocó" }] },
    ]);
    const report = await writeMemories(s, transcript, "s4", { client, model: "m" });
    expect(report.updated).toEqual([ciudad.id]);
    expect(s.all().map((m) => m.content)).toEqual(["Vive en Rosario"]);
  });

  it("el extractor no ve las respuestas del asistente y recibe los temas existentes", async () => {
    const s = await open();
    await s.add({ ...base, subject: "ciudad", content: "Vive en Córdoba" });
    const client = llm([{ memories: [], forget: [] }]);
    await writeMemories(s, [{ role: "user", content: "¿Dónde vivo?" }, { role: "assistant", content: "Vivís en Córdoba" }], "s5", { client, model: "m" });
    const prompt = (client.chat.completions.create.mock.calls[0] as any)[0].messages[1].content as string;
    expect(prompt).toContain("- ciudad: Vive en Córdoba");
    expect(prompt).toContain("Usuario: ¿Dónde vivo?");
    expect(prompt).not.toContain("Vivís en Córdoba");
  });

  it("borra lo que el usuario pide olvidar", async () => {
    const s = await open();
    await s.add({ ...base, subject: "mascota", content: "Tiene un perro llamado Rayo" });
    const report = await writeMemories(s, transcript, "s3", { client: llm([{ memories: [], forget: ["el perro llamado Rayo"] }]), model: "m" });
    expect(report.deleted).toHaveLength(1);
    expect(s.all()).toEqual([]);
  });
});
