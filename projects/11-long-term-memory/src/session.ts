import { generateStructured, type ChatClient } from "@sandbox/agent-core";
import { PII_DETECTORS, SECRET_DETECTORS, scan } from "07-guardrails-eval-proxy/redactors";
import type { MemoryStore, MemoryType } from "./store.js";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** Datos que nunca se guardan en memoria, aunque el usuario los cuente. */
export function containsSensitive(text: string): string[] {
  const { counts } = scan(text, [...SECRET_DETECTORS, ...PII_DETECTORS.filter((d) => d.type !== "email")], () => false);
  return Object.keys(counts);
}

const SYSTEM = (memories: string) =>
  "Eres un asistente personal con memoria de largo plazo. Respondes en español, de forma breve.\n" +
  "Abajo están las memorias relevantes de sesiones anteriores. Úsalas cuando ayuden a responder, sin inventar lo que no está ahí. " +
  "Si una memoria contradice lo que el usuario dice ahora, vale lo que dice ahora.\n\n" +
  `Memorias relevantes:\n${memories || "(ninguna)"}`;

/** Responde un mensaje usando las memorias relevantes (lectura de memoria). */
export async function respond(store: MemoryStore, history: Turn[], message: string, { client, model }: { client: ChatClient; model: string }) {
  const memories = await store.search(message);
  const listing = memories.map((m) => `- [${m.id}] (${m.type}, ${m.subject}) ${m.content}`).join("\n");
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [{ role: "system", content: SYSTEM(listing) }, ...history, { role: "user", content: message }],
  });
  return { reply: response.choices[0]?.message.content ?? "", used: memories.map((m) => m.id) };
}

interface Candidate {
  type: MemoryType;
  subject: string;
  content: string;
  importance: number;
  ttlDays: number | null;
}

type Operation =
  | { op: "add"; candidate: number }
  | { op: "update"; candidate: number; targetId: string; content: string }
  | { op: "delete"; targetId: string; reason: string }
  | { op: "noop"; candidate: number; reason: string };

const candidateSchema = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["semantic", "episodic", "procedural"] },
          subject: { type: "string", description: "Tema corto y estable, en minúsculas: 'ciudad', 'editor', 'lenguaje principal'" },
          content: { type: "string", description: "El dato en tercera persona, autocontenido" },
          importance: { type: "integer", description: "1 a 5" },
          ttlDays: { type: ["integer", "null"], description: "Días hasta que deja de ser cierto, o null si es estable" },
        },
        required: ["type", "subject", "content", "importance", "ttlDays"],
        additionalProperties: false,
      },
    },
    forget: { type: "array", items: { type: "string" }, description: "Temas que el usuario pidió explícitamente olvidar" },
  },
  required: ["memories", "forget"],
  additionalProperties: false,
};

const operationsSchema = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["add", "update", "noop"] },
          candidate: { type: "integer" },
          targetId: { type: ["string", "null"] },
          content: { type: ["string", "null"], description: "Contenido final si op=update" },
          reason: { type: "string" },
        },
        required: ["op", "candidate", "targetId", "content", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["operations"],
  additionalProperties: false,
};

export interface WriteReport {
  added: string[];
  updated: string[];
  deleted: string[];
  skipped: Array<{ content: string; reason: string }>;
}

/**
 * Escritura de memoria al final de la sesión, en dos pasos:
 *  1. Extracción: el LLM propone memorias candidatas (y temas a olvidar).
 *  2. Reconciliación: cada candidata se compara con las memorias parecidas que ya
 *     existen y el LLM decide add / update / noop. Así no se duplican y las
 *     contradicciones se resuelven actualizando ("vivo en Córdoba" → "me mudé a Rosario").
 * Los datos sensibles se descartan antes de llegar al store.
 */
export async function writeMemories(store: MemoryStore, transcript: Turn[], sessionId: string, { client, model }: { client: ChatClient; model: string }): Promise<WriteReport> {
  const report: WriteReport = { added: [], updated: [], deleted: [], skipped: [] };
  // Solo lo que dijo el usuario: si el asistente se equivoca ("vivís en Córdoba"), no debe convertirse en memoria.
  const conversation = transcript.filter((t) => t.role === "user").map((t) => `Usuario: ${t.content}`).join("\n");
  const existing = store.all().filter((m) => m.type !== "episodic");
  const knownSubjects = existing.map((m) => `- ${m.subject}: ${m.content}`).join("\n") || "(ninguno)";

  const extracted = await generateStructured<{ memories: Candidate[]; forget: string[] }>({
    client,
    model,
    name: "memory_candidates",
    schema: candidateSchema,
    system:
      "Extraes memorias de largo plazo sobre el USUARIO a partir de una conversación: hechos sobre él, sus preferencias y cómo le gusta trabajar, " +
      "y un resumen episódico solo si pasó algo importante. No guardes lo que dijo el asistente, ni datos triviales, ni contraseñas, " +
      "claves, tarjetas o documentos. Si el usuario pide olvidar algo, ponlo en 'forget'.\n" +
      "Reutiliza EXACTAMENTE el tema (subject) de un hecho ya guardado cuando hablen de lo mismo. Si un hecho cambió " +
      "(\"me mudé a Rosario\"), emite el hecho estable actualizado con el tema existente (semantic, ciudad: \"vive en Rosario\"); " +
      "el episodio de la mudanza es opcional.",
    user: `Temas ya guardados:\n${knownSubjects}\n\nMensajes del usuario:\n${conversation}`,
  });

  // Olvido a pedido.
  for (const topic of extracted.forget) {
    for (const m of await store.similar(topic, 3)) {
      if (m.similarity > 0.45 && store.delete(m.id)) report.deleted.push(m.id);
    }
  }

  // Privacidad: lo sensible no se guarda nunca.
  const candidates = extracted.memories.filter((c) => {
    const sensitive = containsSensitive(c.content);
    if (sensitive.length) report.skipped.push({ content: `[${sensitive.join(", ")}]`, reason: "dato sensible" });
    return sensitive.length === 0;
  });
  if (candidates.length === 0) {
    await store.save();
    return report;
  }

  const neighbors = await Promise.all(candidates.map((c) => store.similar(`${c.subject}: ${c.content}`, 3)));
  const listing = candidates
    .map((c, i) => {
      const near = neighbors[i].filter((n) => n.similarity > 0.3).map((n) => `    - [${n.id}] (${n.subject}) ${n.content} (similitud ${n.similarity.toFixed(2)})`);
      return `Candidata ${i}: (${c.type}, ${c.subject}) ${c.content}\n  Memorias existentes parecidas:\n${near.join("\n") || "    (ninguna)"}`;
    })
    .join("\n\n");

  const { operations } = await generateStructured<{ operations: Array<{ op: "add" | "update" | "noop"; candidate: number; targetId: string | null; content: string | null; reason: string }> }>({
    client,
    model,
    name: "memory_operations",
    schema: operationsSchema,
    system:
      "Mantienes una base de memorias sin duplicados. Para cada candidata decide:\n" +
      "- add: es información nueva.\n- update: corrige o reemplaza una memoria existente (un dato que cambió o se precisó); indica targetId y el contenido final.\n" +
      "- noop: ya está guardada igual o es redundante.\nUna operación por candidata.",
    user: listing,
  });

  for (const op of operations as Operation[] & any[]) {
    const c = candidates[op.candidate];
    if (!c) continue;
    // Regla determinística: un hecho con el mismo tema que uno guardado nunca se agrega como nuevo
    // (sería una contradicción o un duplicado). Si el LLM dijo "add", se convierte en update.
    // Se busca en el store actual (no en la foto de antes de la sesión): así tampoco se duplican dos candidatas del mismo lote.
    const sameSubject = c.type !== "episodic" ? store.all().find((m) => m.type !== "episodic" && m.subject.toLowerCase() === c.subject.toLowerCase()) : undefined;
    if (op.op === "add" && sameSubject) {
      if (sameSubject.content === c.content) report.skipped.push({ content: c.content, reason: "idéntica a una existente" });
      else report.updated.push((await store.update(sameSubject.id, c.content, c.importance)).id);
      continue;
    }
    if (op.op === "add") report.added.push((await store.add({ ...c, sourceSession: sessionId })).id);
    else if (op.op === "update" && op.targetId && store.get(op.targetId)) report.updated.push((await store.update(op.targetId, op.content ?? c.content, c.importance)).id);
    else if (op.op === "noop") report.skipped.push({ content: c.content, reason: op.reason });
  }
  await store.save();
  return report;
}
