/**
 * Registro de fuentes: cada documento que una tool trae de verdad recibe un id
 * (S1, S2...). El informe solo puede citar ids de este registro, así se puede
 * verificar que ninguna cita es inventada.
 */
export interface Source {
  id: string;
  title: string;
  url: string;
  kind: "wikipedia" | "monorepo";
  /** Fragmento que se le mostró al agente (para revisar después). */
  excerpt: string;
}

export class SourceRegistry {
  private byKey = new Map<string, Source>();

  /** Registra una fuente (si ya existía por url, devuelve la misma). */
  add(source: Omit<Source, "id">): Source {
    const existing = this.byKey.get(source.url);
    if (existing) return existing;
    const entry = { ...source, id: `S${this.byKey.size + 1}` };
    this.byKey.set(source.url, entry);
    return entry;
  }

  get(id: string): Source | undefined {
    return [...this.byKey.values()].find((s) => s.id === id);
  }

  all(): Source[] {
    return [...this.byKey.values()];
  }
}
