import assert from "node:assert/strict";
import type { EvalCase } from "../core/types.js";
import type { HiddenCheck } from "../evaluators/index.js";

/**
 * Dataset del Bug Fixer (04). Cada caso tiene:
 *  - el código con un bug y un test visible que lo detecta (es lo que ve el agente);
 *  - chequeos ocultos con más casos, para detectar parches que "sobreajustan" al test
 *    visible (ej: `if (n === 9) return false`) en vez de arreglar la causa raíz.
 */
export interface BugFixerInput {
  sourceFile: string;
  testFile: string;
  files: Record<string, string>;
  exportName: string;
  hidden: { kind: "checks"; checks: HiddenCheck[] };
  rootCause: string;
  /** Parche correcto, para validar el dataset en los tests (nunca se le muestra al agente). */
  referenceFix: { find: string; replace: string };
}

const check = (description: string, run: HiddenCheck["run"]): HiddenCheck => ({ description, run });

export const bugFixerCases: EvalCase<BugFixerInput>[] = [
  {
    id: "operador-invertido",
    description: "Resta el impuesto en vez de sumarlo (el bug de demo del 04).",
    input: {
      sourceFile: "src/total.ts",
      testFile: "src/total.test.ts",
      exportName: "calculateTotal",
      rootCause: "Usa `price - tax` en lugar de `price + tax`.",
      referenceFix: { find: "price - tax", replace: "price + tax" },
      files: {
        "src/total.ts": "export function calculateTotal(price: number, tax: number): number {\n  return price - tax;\n}\n",
        "src/total.test.ts": 'import { expect, it } from "vitest";\nimport { calculateTotal } from "./total.js";\n\nit("suma el impuesto", () => {\n  expect(calculateTotal(100, 20)).toBe(120);\n});\n',
      },
      hidden: {
        kind: "checks",
        checks: [
          check("calculateTotal(0, 0) = 0", (f) => assert.equal(f(0, 0), 0)),
          check("calculateTotal(50, 7.5) = 57.5", (f) => assert.equal(f(50, 7.5), 57.5)),
          check("calculateTotal(10, 0) = 10", (f) => assert.equal(f(10, 0), 10)),
        ],
      },
    },
  },
  {
    id: "off-by-one",
    description: "rango(a, b) no incluye el último número.",
    input: {
      sourceFile: "src/rango.ts",
      testFile: "src/rango.test.ts",
      exportName: "rango",
      rootCause: "La condición del for es `i < fin` y debería ser `i <= fin` (rango inclusivo).",
      referenceFix: { find: "i < fin", replace: "i <= fin" },
      files: {
        "src/rango.ts": "/** Números enteros de inicio a fin, ambos incluidos. Si inicio > fin, lista vacía. */\nexport function rango(inicio: number, fin: number): number[] {\n  const out: number[] = [];\n  for (let i = inicio; i < fin; i++) out.push(i);\n  return out;\n}\n",
        "src/rango.test.ts": 'import { expect, it } from "vitest";\nimport { rango } from "./rango.js";\n\nit("incluye ambos extremos", () => {\n  expect(rango(1, 3)).toEqual([1, 2, 3]);\n});\n',
      },
      hidden: {
        kind: "checks",
        checks: [
          check("rango(5, 5) = [5]", (f) => assert.deepEqual(f(5, 5), [5])),
          check("rango(3, 1) = []", (f) => assert.deepEqual(f(3, 1), [])),
          check("rango(-2, 1) = [-2,-1,0,1]", (f) => assert.deepEqual(f(-2, 1), [-2, -1, 0, 1])),
          check("rango(0, 9) tiene 10 elementos", (f) => assert.equal(f(0, 9).length, 10)),
        ],
      },
    },
  },
  {
    id: "primo-sobreajustable",
    description: "esPrimo revisa divisores hasta √n sin incluirla: falla con cuadrados de primos.",
    input: {
      sourceFile: "src/primos.ts",
      testFile: "src/primos.test.ts",
      exportName: "esPrimo",
      rootCause: "El for usa `i * i < n` y debería ser `i * i <= n`: los cuadrados de primos (9, 25, 49...) se consideran primos.",
      referenceFix: { find: "i * i < n", replace: "i * i <= n" },
      files: {
        "src/primos.ts": "export function esPrimo(n: number): boolean {\n  if (n < 2) return false;\n  for (let i = 2; i * i < n; i++) {\n    if (n % i === 0) return false;\n  }\n  return true;\n}\n",
        "src/primos.test.ts": 'import { expect, it } from "vitest";\nimport { esPrimo } from "./primos.js";\n\nit("9 no es primo", () => {\n  expect(esPrimo(9)).toBe(false);\n});\n',
      },
      hidden: {
        kind: "checks",
        checks: [
          check("25 no es primo", (f) => assert.equal(f(25), false)),
          check("49 no es primo", (f) => assert.equal(f(49), false)),
          check("121 no es primo", (f) => assert.equal(f(121), false)),
          check("2, 3, 13 y 97 son primos", (f) => [2, 3, 13, 97].forEach((n) => assert.equal(f(n), true, String(n)))),
          check("0, 1 y 4 no son primos", (f) => [0, 1, 4].forEach((n) => assert.equal(f(n), false, String(n)))),
        ],
      },
    },
  },
  {
    id: "promedio-vacio",
    description: "promedio([]) devuelve NaN en vez de 0.",
    input: {
      sourceFile: "src/promedio.ts",
      testFile: "src/promedio.test.ts",
      exportName: "promedio",
      rootCause: "Divide por la longitud sin contemplar la lista vacía (0 / 0 = NaN); debe devolver 0.",
      referenceFix: { find: "  return total / valores.length;", replace: "  return valores.length === 0 ? 0 : total / valores.length;" },
      files: {
        "src/promedio.ts": "/** Promedio de una lista de números. La lista vacía tiene promedio 0. */\nexport function promedio(valores: number[]): number {\n  const total = valores.reduce((a, b) => a + b, 0);\n  return total / valores.length;\n}\n",
        "src/promedio.test.ts": 'import { expect, it } from "vitest";\nimport { promedio } from "./promedio.js";\n\nit("la lista vacía tiene promedio 0", () => {\n  expect(promedio([])).toBe(0);\n});\n',
      },
      hidden: {
        kind: "checks",
        checks: [
          check("promedio([2, 4]) = 3", (f) => assert.equal(f([2, 4]), 3)),
          check("promedio([-1, 1]) = 0", (f) => assert.equal(f([-1, 1]), 0)),
          check("promedio([5]) = 5", (f) => assert.equal(f([5]), 5)),
        ],
      },
    },
  },
];
