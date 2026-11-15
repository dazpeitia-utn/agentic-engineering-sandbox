import type { EvalCase } from "../core/types.js";

/**
 * Dataset del Unit Tester (01). Para medir si los tests generados sirven usamos
 * **mutation testing**: se introducen bugs a propósito (mutantes) en el código y
 * se corren los tests generados. Un buen test "mata" al mutante (falla). El
 * mutation score es la proporción de mutantes que los tests detectan.
 */
export interface Mutant {
  id: string;
  /** Texto exacto a reemplazar en el código original. */
  find: string;
  replace: string;
}

export interface UnitTesterInput {
  sourceFile: string;
  testFile: string;
  source: string;
  mutants: Mutant[];
  /** Mutation score mínimo para pasar. */
  minMutationScore: number;
}

export const unitTesterCases: EvalCase<UnitTesterInput>[] = [
  {
    id: "math",
    description: "sumar y dividir (el ejemplo del 01).",
    input: {
      sourceFile: "src/math.ts",
      testFile: "src/math.test.ts",
      minMutationScore: 0.75,
      source:
        "export function sumar(a: number, b: number): number {\n  return a + b;\n}\n" +
        'export function dividir(a: number, b: number): number {\n  if (b === 0) throw new Error("No se puede dividir por cero");\n  return a / b;\n}\n',
      mutants: [
        { id: "suma-resta", find: "return a + b;", replace: "return a - b;" },
        { id: "division-multiplica", find: "return a / b;", replace: "return a * b;" },
        { id: "sin-chequeo-cero", find: "if (b === 0) throw", replace: "if (b === -1) throw" },
        { id: "division-invertida", find: "return a / b;", replace: "return b / a;" },
      ],
    },
  },
  {
    id: "clamp",
    description: "clamp(x, min, max) limita un número a un rango.",
    input: {
      sourceFile: "src/clamp.ts",
      testFile: "src/clamp.test.ts",
      minMutationScore: 0.75,
      source:
        "/** Limita x al rango [min, max]. Lanza un error si min > max. */\n" +
        "export function clamp(x: number, min: number, max: number): number {\n" +
        '  if (min > max) throw new Error("min no puede ser mayor que max");\n' +
        "  if (x < min) return min;\n" +
        "  if (x > max) return max;\n" +
        "  return x;\n}\n",
      mutants: [
        { id: "sin-limite-inferior", find: "if (x < min) return min;", replace: "if (x < min) return x;" },
        { id: "sin-limite-superior", find: "if (x > max) return max;", replace: "if (x > max) return x;" },
        { id: "limite-cruzado", find: "if (x < min) return min;", replace: "if (x < min) return max;" },
        { id: "sin-validacion", find: "if (min > max) throw", replace: "if (min > max + 1000) throw" },
        { id: "borde-inclusivo", find: "if (x > max) return max;", replace: "if (x >= max) return max - 1;" },
      ],
    },
  },
  {
    id: "palindromo",
    description: "esPalindromo ignora mayúsculas, espacios y acentos.",
    input: {
      sourceFile: "src/palindromo.ts",
      testFile: "src/palindromo.test.ts",
      minMutationScore: 0.75,
      source:
        "/** true si el texto se lee igual al derecho y al revés, ignorando mayúsculas, espacios, signos y acentos. */\n" +
        "export function esPalindromo(texto: string): boolean {\n" +
        '  const limpio = texto.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");\n' +
        '  return limpio === limpio.split("").reverse().join("");\n}\n',
      mutants: [
        { id: "sensible-mayusculas", find: ".toLowerCase()", replace: "" },
        { id: "sensible-acentos", find: '.replace(/[\\u0300-\\u036f]/g, "")', replace: "" },
        { id: "sensible-espacios", find: '.replace(/[^a-z0-9]/g, "")', replace: "" },
        { id: "siempre-true", find: 'return limpio === limpio.split("").reverse().join("");', replace: "return true;" },
      ],
    },
  },
];
