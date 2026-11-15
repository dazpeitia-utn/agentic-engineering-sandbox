import { decide, fingerprint, type Finding, type ReviewResult, type Verdict } from "./review.js";

const ICON: Record<Finding["severity"], string> = { critical: "🔴", major: "🟠", minor: "🟡", nit: "⚪" };
const ORDER: Finding["severity"][] = ["critical", "major", "minor", "nit"];
const MARKER = (fp: string) => `<!-- ai-review:${fp} -->`;

export interface ReviewPayload {
  event: "COMMENT";
  body: string;
  comments: Array<{ path: string; line: number; side: "RIGHT"; body: string }>;
}

/**
 * Arma la review de GitHub: un comentario por línea (como mucho `maxComments`, priorizando
 * severidad) y un resumen. Omite los hallazgos que ya se comentaron en pushes anteriores.
 */
export function buildReview(result: ReviewResult, verdict: Verdict, { existingFingerprints = new Set<string>(), maxComments = 10 } = {}): ReviewPayload {
  const fresh = result.findings.filter((f) => !existingFingerprints.has(fingerprint(f)));
  const sorted = [...fresh].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const inline = sorted.slice(0, maxComments);
  const counts = ORDER.map((s) => `${ICON[s]} ${result.findings.filter((f) => f.severity === s).length} ${s}`).join(" · ");
  const body = [
    `## 🤖 AI code review: ${verdict.conclusion === "success" ? "✅ sin bloqueos" : "⛔ bloquea el merge"}`,
    "",
    result.summary,
    "",
    counts,
    verdict.reason,
    result.injectionSuspected ? "\n⚠️ El diff contiene texto que parece dirigido a asistentes de IA (posible prompt injection)." : "",
    sorted.length > inline.length ? `\n${sorted.length - inline.length} hallazgo(s) más no se comentaron para no hacer ruido.` : "",
    result.findings.length > fresh.length ? `\n${result.findings.length - fresh.length} hallazgo(s) ya comentados en pushes anteriores.` : "",
    "\n<sub>Generado por el agente del proyecto 15. El veredicto lo decide el código a partir de las severidades, no el modelo.</sub>",
  ].filter((l) => l !== "").join("\n");
  return {
    event: "COMMENT",
    body,
    comments: inline.map((f) => ({
      path: f.file,
      line: f.line,
      side: "RIGHT",
      body: `${ICON[f.severity]} **${f.severity}**: ${f.message}${f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : ""}\n${MARKER(fingerprint(f))}`,
    })),
  };
}

export interface GitHubContext {
  repo: string;
  pr: number;
  token: string;
  api?: string;
  fetchFn?: typeof fetch;
}

async function gh(ctx: GitHubContext, path: string, init: RequestInit = {}) {
  const response = await (ctx.fetchFn ?? fetch)(`${ctx.api ?? "https://api.github.com"}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

/** Huellas de los comentarios que el bot ya dejó en el PR. */
export async function existingFingerprints(ctx: GitHubContext): Promise<Set<string>> {
  const comments: Array<{ body: string }> = await gh(ctx, `/repos/${ctx.repo}/pulls/${ctx.pr}/comments?per_page=100`);
  return new Set(comments.flatMap((c) => [...c.body.matchAll(/<!-- ai-review:([a-f0-9]+) -->/g)].map((m) => m[1])));
}

export async function postReview(ctx: GitHubContext, payload: ReviewPayload): Promise<void> {
  await gh(ctx, `/repos/${ctx.repo}/pulls/${ctx.pr}/reviews`, { method: "POST", body: JSON.stringify(payload) });
}

export { decide };
