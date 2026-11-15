import fc from "fast-check";

/**
 * Property-based testing para slugify. En vez de casos fijos, fast-check genera
 * cientos de textos y verifica propiedades que cualquier implementación correcta
 * cumple. Cuando una falla, achica el contraejemplo hasta el caso mínimo.
 */

/** Caracteres con una expectativa sin ambigüedad: ASCII, signos y letras latinas que NFD descompone. */
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ACCENTED = "áéíóúàèìòùâêîôûäëïöüãõñçÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÃÕÑÇ";
const SEPARATORS = " -_.,;:!?¿¡()[]/\\'\"@#$%&*+=\t";

export const slugifyInput = fc
  .array(fc.constantFrom(...LETTERS, ...ACCENTED, ...ACCENTED, ...SEPARATORS), { minLength: 0, maxLength: 24 })
  .map((chars) => chars.join(""));

/** Oráculo: saca diacríticos con NFD (la virgulilla de la ñ y la cedilla de la ç también). */
export function referenceSlugify(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const stripAccents = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");

type Outcome = { ok: true; value: string } | { ok: false; error: string };
const call = (fn: (s: string) => unknown, input: string): Outcome => {
  try {
    const value = fn(input);
    return typeof value === "string" ? { ok: true, value } : { ok: false, error: `devolvió ${typeof value}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
};

export interface PropertyResult {
  property: string;
  description: string;
  passed: boolean;
  /** Contraejemplo mínimo, si falló. */
  counterexample?: string;
  got?: string;
  expected?: string;
}

const PROPERTIES: Array<{ name: string; description: string; check: (fn: (s: string) => unknown, input: string) => { ok: boolean; got?: string; expected?: string } }> = [
  {
    name: "coincide_con_oraculo",
    description: "Devuelve lo mismo que la implementación de referencia (y lanza error exactamente cuando el resultado queda vacío).",
    check: (fn, input) => {
      const expected = referenceSlugify(input);
      const out = call(fn, input);
      if (expected === "") return { ok: !out.ok, got: out.ok ? JSON.stringify(out.value) : "error", expected: "error" };
      return { ok: out.ok && out.value === expected, got: out.ok ? JSON.stringify(out.value) : `error: ${out.error}`, expected: JSON.stringify(expected) };
    },
  },
  {
    name: "formato_valido",
    description: "Solo minúsculas, dígitos y guiones simples, sin guiones al principio ni al final.",
    check: (fn, input) => {
      const out = call(fn, input);
      return { ok: !out.ok || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.value), got: out.ok ? JSON.stringify(out.value) : "error" };
    },
  },
  {
    name: "ignora_acentos",
    description: "Con y sin acentos da lo mismo: slugify(\"Fête\") === slugify(\"Fete\").",
    check: (fn, input) => {
      const a = call(fn, input);
      const b = call(fn, stripAccents(input));
      const same = a.ok === b.ok && (!a.ok || (b.ok && a.value === b.value));
      return { ok: same, got: a.ok ? JSON.stringify(a.value) : "error", expected: b.ok ? JSON.stringify(b.value) : "error" };
    },
  },
  {
    name: "idempotente",
    description: "Aplicarla dos veces da lo mismo que una: slugify(slugify(x)) === slugify(x).",
    check: (fn, input) => {
      const once = call(fn, input);
      if (!once.ok) return { ok: true };
      const twice = call(fn, once.value);
      return { ok: twice.ok && twice.value === once.value, got: twice.ok ? JSON.stringify(twice.value) : "error", expected: JSON.stringify(once.value) };
    },
  },
];

export function checkSlugifyProperties(fn: (s: string) => unknown, { numRuns = 400, seed = 42 } = {}): PropertyResult[] {
  return PROPERTIES.map(({ name, description, check }) => {
    const result = fc.check(fc.property(slugifyInput, (input) => check(fn, input).ok), { numRuns, seed });
    if (!result.failed) return { property: name, description, passed: true };
    const counterexample = result.counterexample![0];
    const { got, expected } = check(fn, counterexample);
    return { property: name, description, passed: false, counterexample, got, expected };
  });
}
