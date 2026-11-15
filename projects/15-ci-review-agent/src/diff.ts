/**
 * Parser de diffs unificados. Lo importante para comentar en un PR: GitHub solo acepta
 * comentarios en líneas que aparecen en el diff, del lado "RIGHT" (la versión nueva).
 */
export interface DiffLine {
  /** Número de línea en la versión nueva del archivo. */
  line: number;
  kind: "added" | "context";
  text: string;
}

export interface FileDiff {
  path: string;
  lines: DiffLine[];
  deleted: boolean;
  binary: boolean;
}

export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let newLine = 0;
  // Líneas que faltan leer del hunk actual (del encabezado @@ -a,b +c,d @@): así una línea de
  // contexto vacía, a la que un editor le borró el espacio inicial, no desfasa la numeración.
  let oldLeft = 0;
  let newLeft = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const match = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = { path: match?.[2] ?? "", lines: [], deleted: false, binary: false };
      files.push(current);
      continue;
    }
    if (!current) continue;

    // Dentro de un hunk, todo es contenido: una línea borrada "-- x" llega como "--- x"
    // y no debe confundirse con un encabezado de archivo.
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        current.lines.push({ line: newLine++, kind: "added", text: raw.slice(1) });
        newLeft--;
      } else if (raw.startsWith("-")) {
        // Las líneas borradas no existen en la versión nueva: no avanzan el contador.
        oldLeft--;
      } else if (raw.startsWith(" ") || raw === "") {
        current.lines.push({ line: newLine++, kind: "context", text: raw.slice(1) });
        oldLeft--;
        newLeft--;
      }
      continue;
    }

    if (raw.startsWith("+++ ")) {
      if (raw === "+++ /dev/null") current.deleted = true;
      else current.path = raw.replace(/^\+\+\+ b\//, "");
      continue;
    }
    if (raw.startsWith("Binary files")) {
      current.binary = true;
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLine = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return files.filter((f) => f.path && !f.deleted && !f.binary);
}

/** El diff en un formato legible para el LLM: cada línea con su número real, marcando las agregadas. */
export function renderForReview(files: FileDiff[], maxChars = 60_000): string {
  let out = "";
  for (const f of files) {
    const block = `### ${f.path}\n${f.lines.map((l) => `${l.kind === "added" ? "+" : " "}${String(l.line).padStart(5)} | ${l.text}`).join("\n")}\n\n`;
    if (out.length + block.length > maxChars) {
      out += `### (diff recortado: faltan archivos desde ${f.path})\n`;
      break;
    }
    out += block;
  }
  return out;
}

/** ¿Se puede comentar en esta línea? (tiene que estar en el diff, del lado nuevo). */
export function isCommentable(files: FileDiff[], path: string, line: number): boolean {
  return files.some((f) => f.path === path && f.lines.some((l) => l.line === line));
}
