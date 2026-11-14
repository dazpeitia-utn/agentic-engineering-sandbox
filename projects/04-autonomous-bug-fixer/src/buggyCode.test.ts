// Este test FALLA a propósito mientras buggyCode.ts tenga el bug de demo.
// Está excluido del `npm test` de la raíz (ver vitest.config.ts); el agente 04
// lo corre con run_tests para capturar el error real y validar su parche.
import { describe, expect, it } from "vitest";
import { calculateTotal } from "./buggyCode.js";

describe("calculateTotal", () => {
  it("suma el impuesto al precio", () => {
    expect(calculateTotal(100, 20)).toBe(120);
  });

  it("con impuesto 0 devuelve el precio", () => {
    expect(calculateTotal(50, 0)).toBe(50);
  });

  it("funciona con decimales", () => {
    expect(calculateTotal(10.5, 2.1)).toBeCloseTo(12.6);
  });
});
