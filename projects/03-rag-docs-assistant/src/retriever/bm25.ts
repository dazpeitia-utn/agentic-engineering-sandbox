/** Palabras muy frecuentes que no aportan a la búsqueda léxica. */
const STOPWORDS = new Set(
  ("el la los las un una unos unas de del al a en y o u que se por para con sin es son su sus lo como mas más " +
    "este esta estos estas ese esa eso the of and to in is for on with it").split(" "),
);

/** Minúsculas, sin acentos, separando por todo lo que no sea letra o número. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Índice BM25 en memoria: búsqueda léxica que premia términos exactos poco
 * frecuentes (nombres de tools, archivos, siglas), justo donde los embeddings
 * suelen fallar.
 */
export class Bm25Index {
  private docs: Array<Map<string, number>>;
  private lengths: number[];
  private avgLength: number;
  private docFreq = new Map<string, number>();

  constructor(texts: string[], private k1 = 1.5, private b = 0.75) {
    this.docs = texts.map((text) => {
      const tf = new Map<string, number>();
      for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + 1);
      return tf;
    });
    this.lengths = this.docs.map((tf) => [...tf.values()].reduce((a, c) => a + c, 0));
    this.avgLength = this.lengths.reduce((a, c) => a + c, 0) / Math.max(this.docs.length, 1);
    for (const tf of this.docs) for (const term of tf.keys()) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
  }

  /** Puntaje BM25 de cada documento para la consulta (mismo orden que `texts`). */
  score(query: string): number[] {
    const n = this.docs.length;
    const terms = [...new Set(tokenize(query))];
    return this.docs.map((tf, i) => {
      let score = 0;
      for (const term of terms) {
        const freq = tf.get(term);
        if (!freq) continue;
        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * freq * (this.k1 + 1)) / (freq + this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLength));
      }
      return score;
    });
  }
}
