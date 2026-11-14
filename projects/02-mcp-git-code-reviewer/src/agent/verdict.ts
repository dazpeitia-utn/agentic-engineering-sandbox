export type Verdict = "approved" | "blocked" | "unknown";

/** Lee la última línea "VEREDICTO: ..." de la review. */
export function parseVerdict(review: string): Verdict {
  const matches = [...review.matchAll(/VEREDICTO:\s*\**\s*(APROBADO|BLOQUEAR)/gi)];
  const last = matches.at(-1)?.[1]?.toUpperCase();
  if (last === "BLOQUEAR") return "blocked";
  if (last === "APROBADO") return "approved";
  return "unknown";
}

export interface PushedRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

const ZERO_SHA = /^0+$/;

/**
 * Parsea lo que git le pasa al hook pre-push por stdin:
 * "<local ref> <local sha> <remote ref> <remote sha>" por línea.
 * Omite los borrados de ramas (local sha en ceros).
 */
export function parsePrePushInput(stdin: string): PushedRef[] {
  return stdin
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }))
    .filter((ref) => !ZERO_SHA.test(ref.localSha));
}

/** true si el remoto todavía no tiene esa rama (push de una rama nueva). */
export const isNewBranch = (ref: PushedRef) => ZERO_SHA.test(ref.remoteSha);
