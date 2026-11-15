import { requireString, type AgentTool } from "@sandbox/agent-core";
import type { SourceRegistry } from "../sources.js";

/** Cliente genérico: no mandamos datos del usuario a la API de Wikipedia. */
const USER_AGENT = "agentic-engineering-sandbox/1.0 (proyecto educativo)";

export type Fetcher = (url: string) => Promise<any>;

/**
 * Fetcher "educado" con la API pública: un request por vez con una pausa mínima
 * entre requests, y reintentos ante 429/5xx respetando Retry-After. Sin esto, varios
 * subagentes en paralelo (como hace deepagents) disparan el rate limit de Wikipedia.
 */
export function politeFetcher({ minIntervalMs = 400, retries = 3, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {}): Fetcher {
  let queue: Promise<unknown> = Promise.resolve();
  let last = 0;
  return (url) => {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = last + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
        if (response.ok) return response.json();
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        throw new Error(`HTTP ${response.status} al consultar ${new URL(url).host}`);
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}

export const httpFetcher: Fetcher = politeFetcher();

const lang = (args: Record<string, unknown>) => (args.lang === "en" ? "en" : "es");
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "");

export function wikipediaTools(registry: SourceRegistry, fetcher: Fetcher = httpFetcher): AgentTool[] {
  return [
    {
      name: "wikipedia_search",
      description: "Busca artículos en Wikipedia. Devuelve títulos y un fragmento de cada uno (no son fuentes citables hasta leerlas con wikipedia_page).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, lang: { type: "string", enum: ["es", "en"], description: "Idioma (default es)" } },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(args) {
        const l = lang(args);
        const url = `https://${l}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(requireString(args, "query"))}`;
        const data = await fetcher(url);
        const results = (data?.query?.search ?? []) as Array<{ title: string; snippet: string }>;
        if (results.length === 0) return "Sin resultados.";
        return results.map((r) => `- ${r.title} (${l}): ${stripHtml(r.snippet)}`).join("\n");
      },
    },
    {
      name: "wikipedia_page",
      description: "Lee un artículo de Wikipedia por su título exacto. Lo registra como fuente citable y devuelve su id (S1, S2...).",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, lang: { type: "string", enum: ["es", "en"] } },
        required: ["title"],
        additionalProperties: false,
      },
      async execute(args) {
        const l = lang(args);
        const title = requireString(args, "title");
        const url = `https://${l}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
        const data = await fetcher(url);
        const page = Object.values(data?.query?.pages ?? {})[0] as { title?: string; extract?: string; missing?: string } | undefined;
        if (!page || page.missing !== undefined || !page.extract) return `No existe el artículo "${title}" en ${l}.wikipedia.org. Usá wikipedia_search para encontrar el título exacto.`;
        const text = page.extract.slice(0, 6000);
        const source = registry.add({
          title: `${page.title} (Wikipedia ${l})`,
          url: `https://${l}.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, "_"))}`,
          kind: "wikipedia",
          excerpt: text.slice(0, 2000),
        });
        return `[Fuente ${source.id}: ${source.title} — ${source.url}]\n${text}${page.extract.length > 6000 ? "\n...[artículo recortado]" : ""}`;
      },
    },
  ];
}

export interface DocsHit {
  source: string;
  section: string;
  content: string;
}

/** Búsqueda en la documentación del monorepo, reutilizando el RAG híbrido del proyecto 03. */
export function monorepoDocsTool(registry: SourceRegistry, search: (query: string) => Promise<DocsHit[]>): AgentTool {
  return {
    name: "monorepo_docs_search",
    description: "Busca en la documentación de los proyectos del monorepo (READMEs). Cada fragmento devuelto queda registrado como fuente citable.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    async execute(args) {
      const hits = await search(requireString(args, "query"));
      if (hits.length === 0) return "Sin resultados en la documentación del monorepo.";
      return hits
        .map((hit) => {
          const source = registry.add({ title: `${hit.source} — ${hit.section}`, url: `repo://${hit.source}#${hit.section}`, kind: "monorepo", excerpt: hit.content.slice(0, 2000) });
          return `[Fuente ${source.id}: ${source.title}]\n${hit.content}`;
        })
        .join("\n\n---\n\n");
    },
  };
}
