import assert from "node:assert/strict";
import type { EvalCase } from "../core/types.js";
import type { HiddenCheck, HiddenSpec } from "../evaluators/index.js";

/** Dataset del orquestador (06): tareas completas, verificadas con chequeos que ningún agente ve. */
export interface OrchestratorInput {
  task: string;
  exportName: string;
  hidden: HiddenSpec;
}

const check = (description: string, run: HiddenCheck["run"]): HiddenCheck => ({ description, run });

export const orchestratorCases: EvalCase<OrchestratorInput>[] = [
  {
    id: "slugify",
    description: "La tarea de demo del 06, verificada con property-based testing.",
    input: {
      exportName: "slugify",
      task:
        "Implementar una función slugify(texto) que convierta un título en un slug para URLs: minúsculas, " +
        "sin acentos ni eñes (ñ → n), espacios y signos reemplazados por guiones, sin guiones repetidos ni al principio o al final. " +
        "Si el resultado queda vacío, lanzar un error. Exportarla con nombre: export function slugify.",
      hidden: { kind: "slugify-properties" },
    },
  },
  {
    id: "validar-cuit",
    description: "Validación de CUIT/CUIL argentino con dígito verificador.",
    input: {
      exportName: "validarCuit",
      task:
        "Implementar validarCuit(cuit: string): boolean para CUIT/CUIL argentinos. Acepta 11 dígitos con o sin guiones (20-12345678-6 o 20123456786). " +
        "Prefijos válidos: 20, 23, 24, 27, 30, 33, 34. El dígito verificador se calcula multiplicando los primeros 10 dígitos por 5,4,3,2,7,6,5,4,3,2, " +
        "sumando, y haciendo 11 - (suma % 11); si da 11 el verificador es 0 y si da 10 el CUIT es inválido. Exportarla con nombre: export function validarCuit.",
      hidden: {
        kind: "checks",
        checks: [
          check("20-12345678-6 es válido", (f) => assert.equal(f("20-12345678-6"), true)),
          check("20123456786 (sin guiones) es válido", (f) => assert.equal(f("20123456786"), true)),
          check("30-71234567-1 es válido", (f) => assert.equal(f("30-71234567-1"), true)),
          check("20-00000006-0 es válido (verificador 11 → 0)", (f) => assert.equal(f("20-00000006-0"), true)),
          check("dígito verificador incorrecto es inválido", (f) => assert.equal(f("20-12345678-5"), false)),
          check("prefijo 21 es inválido", (f) => assert.equal(f("21-12345678-9"), false)),
          check("menos de 11 dígitos es inválido", (f) => assert.equal(f("20-1234567-6"), false)),
          check("letras son inválidas", (f) => assert.equal(f("20-1234567A-6"), false)),
          check("vacío es inválido", (f) => assert.equal(f(""), false)),
        ],
      },
    },
  },
  {
    id: "formatear-bytes",
    description: "Formateo de tamaños de archivo legible por humanos.",
    input: {
      exportName: "formatearBytes",
      task:
        "Implementar formatearBytes(bytes: number): string que devuelva el tamaño legible en base 1024 con unidades B, KB, MB, GB, TB. " +
        'Hasta 1023 se muestra en B sin decimales ("0 B", "512 B"); desde KB, con un decimal salvo que sea entero ("1 KB", "1.5 KB", "1 MB"). ' +
        "Valores negativos o no finitos lanzan un error. Exportarla con nombre: export function formatearBytes.",
      hidden: {
        kind: "checks",
        checks: [
          check('0 → "0 B"', (f) => assert.equal(f(0), "0 B")),
          check('512 → "512 B"', (f) => assert.equal(f(512), "512 B")),
          check('1023 → "1023 B"', (f) => assert.equal(f(1023), "1023 B")),
          check('1024 → "1 KB"', (f) => assert.equal(f(1024), "1 KB")),
          check('1536 → "1.5 KB"', (f) => assert.equal(f(1536), "1.5 KB")),
          check('1048576 → "1 MB"', (f) => assert.equal(f(1048576), "1 MB")),
          check('5 GB exactos → "5 GB"', (f) => assert.equal(f(5 * 1024 ** 3), "5 GB")),
          check("-1 lanza error", (f) => assert.throws(() => f(-1))),
          check("NaN lanza error", (f) => assert.throws(() => f(Number.NaN))),
        ],
      },
    },
  },
];
