import type { Source } from "./sources.js";

export interface CitationCheck {
  /** Ids citados en el informe (sin repetir). */
  cited: string[];
  /** Citas a fuentes que nunca se consultaron: alucinaciones. */
  invalid: string[];
  /** Fuentes consultadas pero no citadas. */
  unused: string[];
  /** Párrafos con contenido que no tienen ninguna cita. */
  uncitedParagraphs: number;
}

/** Verifica las citas [S1], [S2, S3] del informe contra las fuentes realmente consultadas. */
export function checkCitations(report: string, sources: Source[]): CitationCheck {
  const ids = new Set(sources.map((s) => s.id));
  const cited = [...new Set([...report.matchAll(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g)].flatMap((m) => m[1].split(/\s*,\s*/)))];
  const body = report.split(/^##\s*Fuentes/im)[0];
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 80 && !p.startsWith("#"));
  return {
    cited,
    invalid: cited.filter((id) => !ids.has(id)),
    unused: [...ids].filter((id) => !cited.includes(id)),
    uncitedParagraphs: paragraphs.filter((p) => !/\[S\d+/.test(p)).length,
  };
}

/** Reemplaza la sección de fuentes por la lista real del registro (el agente no puede inventar URLs). */
export function withSourcesSection(report: string, sources: Source[], cited: string[]): string {
  const body = report.split(/^##\s*Fuentes/im)[0].trimEnd();
  const list = sources.filter((s) => cited.includes(s.id)).map((s) => `- **[${s.id}]** ${s.title}${s.url.startsWith("http") ? ` — ${s.url}` : ""}`);
  return `${body}\n\n## Fuentes\n\n${list.join("\n") || "(ninguna fuente citada)"}\n`;
}
