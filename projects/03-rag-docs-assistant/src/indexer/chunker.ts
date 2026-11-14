export interface Chunk {
  /** Ruta de la fuente relativa al monorepo, ej: projects/02-x/README.md */
  source: string;
  /** Jerarquía de títulos de la sección, ej: "02 - MCP Git > Conceptos Clave" */
  section: string;
  /** Texto del fragmento, con la sección al principio para dar contexto al embedding. */
  content: string;
}

export interface ChunkOptions {
  /** Largo máximo aproximado de un fragmento, en caracteres. */
  maxChars?: number;
  /** Caracteres que se repiten entre fragmentos consecutivos de una misma sección. */
  overlap?: number;
}

/**
 * Parte un markdown por secciones (#, ##, ###...). Cada fragmento lleva su
 * ruta de títulos, así un párrafo suelto no pierde el contexto de a qué
 * proyecto o tema pertenece. Las secciones largas se parten con solapamiento.
 * Ignora los `#` dentro de bloques de código.
 */
export function chunkMarkdown(markdown: string, source: string, { maxChars = 1200, overlap = 150 }: ChunkOptions = {}): Chunk[] {
  const sections: Array<{ headings: string[]; lines: string[] }> = [];
  const headingStack: string[] = [];
  let current = { headings: [] as string[], lines: [] as string[] };
  let inCode = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const match = !inCode && /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      sections.push(current);
      const level = match[1].length;
      headingStack.length = level - 1;
      headingStack[level - 1] = match[2].trim();
      current = { headings: headingStack.filter(Boolean), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const chunks: Chunk[] = [];
  for (const { headings, lines } of sections) {
    const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (body.replace(/[-\s]/g, "").length < 20) continue; // secciones vacías o solo separadores
    const section = headings.join(" > ");
    for (const piece of splitWithOverlap(body, maxChars, overlap)) {
      chunks.push({ source, section, content: section ? `${section}\n\n${piece}` : piece });
    }
  }
  return chunks;
}

/** Parte un texto largo por párrafos, sin pasarse de maxChars, repitiendo `overlap` caracteres. */
function splitWithOverlap(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let buffer = "";
  for (const paragraph of text.split(/\n\n/)) {
    if (buffer && buffer.length + paragraph.length + 2 > maxChars) {
      pieces.push(buffer);
      buffer = buffer.slice(-overlap);
    }
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    while (buffer.length > maxChars) {
      pieces.push(buffer.slice(0, maxChars));
      buffer = buffer.slice(maxChars - overlap);
    }
  }
  if (buffer.trim()) pieces.push(buffer);
  return pieces;
}
