/**
 * Revisor de PRs. Funciona igual en GitHub Actions y en local.
 *
 *   En CI (lo llama .github/workflows/ai-review.yml): lee el evento del PR, revisa y publica.
 *   En local, sin publicar nada (dry-run):
 *     npm run review -w 15-ci-review-agent -- --base origin/main --head HEAD
 *   En local, publicando en un PR (usa tu token de gh; pide confirmación explícita):
 *     GITHUB_TOKEN=$(gh auth token) npm run review -w 15-ci-review-agent -- --pr 42 --repo owner/name --post
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createLLM, loadEnv } from "@sandbox/agent-core";
import { parseUnifiedDiff } from "./diff.js";
import { buildReview, decide, existingFingerprints, postReview } from "./github.js";
import { reviewDiff } from "./review.js";

const flag = (name: string) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : undefined);
const validRef = (ref: string) => {
  if (!/^[\w./~^-]+$/.test(ref) || ref.startsWith("-")) throw new Error(`Ref inválido: ${ref}`);
  return ref;
};

async function main() {
  loadEnv(); // en local la key está en el .env de la raíz; en CI viene del secreto
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf-8")) : null;
  const pr = event?.pull_request;
  const base = validRef(flag("base") ?? pr?.base?.sha ?? "origin/main");
  const head = validRef(flag("head") ?? pr?.head?.sha ?? "HEAD");
  const labels: string[] = (pr?.labels ?? []).map((l: any) => l.name);
  const post = Boolean(pr) || process.argv.includes("--post");

  if (!process.env.OPENAI_API_KEY && !process.env.LLM_PROVIDER) {
    // Sin secreto (ej: PR desde un fork, o el repo todavía no lo configuró): se omite sin fallar.
    console.log("ℹ️ OPENAI_API_KEY no está configurada: se omite la revisión con IA.");
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "ℹ️ AI review omitida: falta el secreto `OPENAI_API_KEY`.\n");
    return;
  }

  // Diff entre el merge-base y el head (lo mismo que muestra GitHub en el PR). Sin shell.
  const diff = execFileSync("git", ["diff", "--no-color", "--end-of-options", `${base}...${head}`], { maxBuffer: 50 * 1024 * 1024 }).toString();
  const files = parseUnifiedDiff(diff);
  console.log(`🔍 Revisando ${files.length} archivo(s) (${base.slice(0, 12)}...${head.slice(0, 12)})`);
  if (files.length === 0) return console.log("Sin cambios para revisar.");

  const llm = await createLLM();
  const result = await reviewDiff(files, { client: llm.client, model: llm.model, title: pr?.title ?? "" });
  const verdict = decide(result.findings, labels);

  for (const f of result.findings) console.log(`  ${f.severity.padEnd(8)} ${f.file}:${f.line}  ${f.message.slice(0, 140)}`);
  if (result.discarded) console.log(`  (${result.discarded} hallazgo(s) del modelo descartados: apuntaban a líneas fuera del diff)`);
  console.log(`\n${verdict.conclusion === "success" ? "✅" : "⛔"} ${verdict.reason}`);

  const repo = flag("repo") ?? process.env.GITHUB_REPOSITORY;
  const number = Number(flag("pr") ?? pr?.number);
  if (post && repo && number && process.env.GITHUB_TOKEN) {
    const ctx = { repo, pr: number, token: process.env.GITHUB_TOKEN };
    const payload = buildReview(result, verdict, { existingFingerprints: await existingFingerprints(ctx) });
    await postReview(ctx, payload);
    console.log(`💬 Review publicada en ${repo}#${number} (${payload.comments.length} comentario(s) en línea).`);
  } else {
    console.log("\n(dry-run: no se publicó nada en GitHub)");
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### AI review: ${verdict.conclusion}\n${verdict.reason}\n`);
  process.exitCode = verdict.conclusion === "success" ? 0 : 1;
}

main().catch((error) => {
  console.error("❌", error?.message ?? error);
  process.exit(1);
});
