import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./indexer/chunker.js";
import { Bm25Index, tokenize } from "./retriever/bm25.js";
import { cosineSimilarity, hybridSearch, reciprocalRankFusion, type IndexedChunk } from "./retriever/hybrid.js";

describe("chunkMarkdown", () => {
  const md = [
    "# Proyecto 02",
    "Intro del proyecto con suficiente texto para contar.",
    "## Conceptos",
    "### MCP",
    "El servidor expone get_git_diff por stdio.",
    "## Código",
    "```bash",
    "# esto es un comentario, no un título",
    "npm start",
    "```",
    "---",
  ].join("\n");

  it("arma la jerarquía de títulos de cada sección", () => {
    const chunks = chunkMarkdown(md, "projects/02/README.md");
    expect(chunks.map((c) => c.section)).toEqual(["Proyecto 02", "Proyecto 02 > Conceptos > MCP", "Proyecto 02 > Código"]);
    expect(chunks[1].content).toMatch(/^Proyecto 02 > Conceptos > MCP\n\nEl servidor expone/);
  });

  it("no toma los # dentro de bloques de código como títulos", () => {
    const code = chunkMarkdown(md, "x").find((c) => c.section.endsWith("Código"))!;
    expect(code.content).toContain("# esto es un comentario");
  });

  it("parte secciones largas con solapamiento", () => {
    const long = "# T\n" + Array.from({ length: 10 }, (_, i) => `Párrafo ${i} ${"x".repeat(80)}`).join("\n\n");
    const chunks = chunkMarkdown(long, "x", { maxChars: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(300 + "T\n\n".length);
  });
});

describe("BM25", () => {
  it("normaliza acentos y saca stopwords", () => {
    expect(tokenize("¿Cómo funciona la Indexación del RAG?")).toEqual(["funciona", "indexacion", "rag"]);
  });

  it("prioriza el documento con el término exacto", () => {
    const index = new Bm25Index(["el agente usa read_file", "el servidor expone get_git_diff", "otra cosa"]);
    const scores = index.score("get_git_diff");
    expect(scores.indexOf(Math.max(...scores))).toBe(1);
    expect(scores[2]).toBe(0);
  });
});

describe("búsqueda híbrida", () => {
  it("cosine de vectores iguales es 1 y con vector cero es 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("RRF premia a los que aparecen arriba en ambos rankings", () => {
    const fused = reciprocalRankFusion([[0, 1, 2], [1, 0, 2]]);
    expect(fused.get(0)).toBeCloseTo(fused.get(1)!);
    expect(fused.get(2)!).toBeLessThan(fused.get(0)!);
  });

  it("encuentra por palabra clave aunque el embedding no ayude", () => {
    const chunks: IndexedChunk[] = [
      { source: "a", section: "A", content: "texto general sobre agentes", embedding: [1, 0] },
      { source: "b", section: "B", content: "la tool get_git_diff devuelve el diff", embedding: [0, 1] },
    ];
    // El embedding de la consulta se parece a "a", pero BM25 encuentra "b".
    const results = hybridSearch(chunks, "get_git_diff", [1, 0], 2);
    expect(results.map((r) => r.source)).toContain("b");
    expect(results.find((r) => r.source === "b")).toMatchObject({ keywordRank: 1, vectorRank: 2 });
  });
});
