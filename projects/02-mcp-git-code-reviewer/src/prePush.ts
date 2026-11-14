/**
 * Hook pre-push: revisa con el agente los commits que se van a pushear y
 * bloquea el push si encuentra problemas críticos.
 *
 * Se instala con `npm run hooks:install` desde la raíz del monorepo.
 * Para saltearlo: `git push --no-verify` o `SKIP_AI_REVIEW=1 git push`.
 */
import { runGitReviewerAgent } from "./agent/agent.js";
import { isNewBranch, parsePrePushInput, type PushedRef } from "./agent/verdict.js";
import { runGit } from "./mcp-server/git.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/** Para una rama nueva, la base es donde se separa de la rama principal del remoto. */
async function baseFor(ref: PushedRef, cwd: string): Promise<string | null> {
  if (!isNewBranch(ref)) return ref.remoteSha;
  for (const candidate of ["origin/HEAD", "origin/main", "origin/master"]) {
    try {
      return await runGit(["merge-base", ref.localSha, candidate], cwd);
    } catch {
      // probamos el siguiente
    }
  }
  return null;
}

async function main(): Promise<number> {
  if (process.env.SKIP_AI_REVIEW === "1") return 0;
  if (!process.env.OPENAI_API_KEY) {
    const { loadEnv } = await import("@sandbox/agent-core");
    loadEnv();
    if (!process.env.OPENAI_API_KEY) {
      console.warn("⚠️ [AI review] Sin OPENAI_API_KEY: se omite la revisión.");
      return 0;
    }
  }

  const cwd = await runGit(["rev-parse", "--show-toplevel"]);
  const refs = parsePrePushInput(await readStdin());
  let blocked = false;

  for (const ref of refs) {
    const base = await baseFor(ref, cwd);
    if (!base) {
      console.warn(`⚠️ [AI review] No encontré una base para ${ref.localRef}; se omite.`);
      continue;
    }
    console.log(`🔍 [AI review] Revisando ${ref.localRef} (${base.slice(0, 7)}..${ref.localSha.slice(0, 7)})...`);
    const { review, verdict } = await runGitReviewerAgent({ range: { base, head: ref.localSha }, cwd, quiet: true });
    console.log(`\n${review ?? "(el agente no llegó a una conclusión)"}\n`);

    if (verdict === "blocked") {
      blocked = true;
      console.error(`⛔ [AI review] Push bloqueado para ${ref.localRef}. Corregí los problemas o usá --no-verify.`);
    } else if (verdict === "unknown") {
      console.warn(`⚠️ [AI review] Sin veredicto claro para ${ref.localRef}; no se bloquea.`);
    } else {
      console.log(`✅ [AI review] ${ref.localRef} aprobado.`);
    }
  }
  return blocked ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // Un error del revisor (red, API caída) no debe impedir pushear.
    console.error("⚠️ [AI review] Error en la revisión, no se bloquea el push:", error?.message ?? error);
    process.exit(0);
  });
