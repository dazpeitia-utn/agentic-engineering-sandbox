export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/**
 * Coincidencia entre un juez y una referencia (ambos pasa/no pasa).
 * - agreement: % de casos en que coinciden.
 * - kappa de Cohen: coincidencia corregida por azar (1 = perfecta, 0 = como tirar una moneda, <0 = peor que el azar).
 */
export function agreement(pairs: Array<[judge: boolean, reference: boolean]>): { agreement: number; kappa: number; n: number } {
  const n = pairs.length;
  if (n === 0) return { agreement: 0, kappa: 0, n };
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const judgeYes = pairs.filter(([a]) => a).length / n;
  const refYes = pairs.filter(([, b]) => b).length / n;
  const chance = judgeYes * refYes + (1 - judgeYes) * (1 - refYes);
  const kappa = chance === 1 ? (agree === 1 ? 1 : 0) : (agree - chance) / (1 - chance);
  return { agreement: agree, kappa, n };
}
