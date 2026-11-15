/**
 * CLI del asistente con memoria. Cada `session` es una sesión nueva: no comparte
 * nada con la anterior salvo el store de memorias en disco.
 *
 *   npm run memory -w 11-long-term-memory -- session "mensaje 1" "mensaje 2" ...
 *   npm run memory -w 11-long-term-memory -- chat                      (interactivo)
 *   npm run memory -w 11-long-term-memory -- list | show <id> | edit <id> "nuevo contenido" | forget <id> | forget --expired
 */
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createOpenAI, defaultModel } from "@sandbox/agent-core";
import { respond, writeMemories, type Turn } from "./session.js";
import { MemoryStore, type Embedder } from "./store.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_FILE = process.env.MEMORY_FILE ?? path.join(PROJECT_ROOT, "data", "memories.json");

const client = createOpenAI();
const model = defaultModel();
const embed: Embedder = async (texts) => (await client.embeddings.create({ model: "text-embedding-3-small", input: texts })).data.sort((a, b) => a.index - b.index).map((d) => d.embedding);

async function runSession(messages: AsyncIterable<string> | string[], store: MemoryStore) {
  const sessionId = new Date().toISOString();
  const transcript: Turn[] = [];
  for await (const message of messages) {
    const { reply, used } = await respond(store, transcript, message, { client, model });
    console.log(`👤 ${message}\n🤖 ${reply}${used.length ? `\n   🧠 usó memorias: ${used.join(", ")}` : ""}\n`);
    transcript.push({ role: "user", content: message }, { role: "assistant", content: reply });
  }
  const report = await writeMemories(store, transcript, sessionId, { client, model });
  console.log(`💾 Memoria: +${report.added.length} nuevas · ${report.updated.length} actualizadas · ${report.deleted.length} borradas · ${report.skipped.length} descartadas`);
  for (const s of report.skipped) console.log(`   ⏭️ ${s.content} — ${s.reason}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const store = await MemoryStore.open(STORE_FILE, embed);

  if (command === "session") return runSession(args, store);

  if (command === "chat") {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("Escribí tus mensajes (línea vacía para terminar la sesión).");
    async function* lines() {
      while (true) {
        const line = (await rl.question("> ")).trim();
        if (!line) return;
        yield line;
      }
    }
    await runSession(lines(), store);
    rl.close();
    return;
  }

  if (command === "list") {
    const all = store.all({ includeExpired: true });
    if (!all.length) return console.log("No hay memorias.");
    for (const m of all.sort((a, b) => b.importance - a.importance)) {
      console.log(`[${m.id}] ${"★".repeat(m.importance)} ${m.type}/${m.subject}: ${m.content}${store.isExpired(m) ? " (vencida)" : m.expiresAt ? ` (vence ${m.expiresAt.slice(0, 10)})` : ""}${m.history.length ? ` · ${m.history.length} versión(es) anterior(es)` : ""}`);
    }
    return;
  }

  if (command === "show") {
    const { embedding, ...m } = store.get(args[0]) ?? (() => { throw new Error(`No existe ${args[0]}`); })();
    return console.log(JSON.stringify(m, null, 2));
  }

  if (command === "edit") {
    await store.update(args[0], args.slice(1).join(" "));
    await store.save();
    return console.log(`✏️ Memoria ${args[0]} actualizada.`);
  }

  if (command === "forget") {
    const removed = args[0] === "--expired" ? store.purgeExpired() : Number(store.delete(args[0]));
    await store.save();
    return console.log(`🗑️ ${removed} memoria(s) borrada(s).`);
  }

  throw new Error("Comandos: session, chat, list, show, edit, forget");
}

main().catch((error) => {
  console.error("❌", error?.message ?? error);
  process.exit(1);
});
