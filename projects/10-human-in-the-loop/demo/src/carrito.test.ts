import { expect, it } from "vitest";
import { totalCarrito } from "./carrito.js";

it("suma el carrito con IVA", () => {
  expect(totalCarrito([{ nombre: "libro", precio: 100, cantidad: 2 }])).toBeCloseTo(242);
});

it("aplica el descuento antes del IVA", () => {
  expect(totalCarrito([{ nombre: "libro", precio: 100, cantidad: 1 }], 0.1)).toBeCloseTo(108.9);
});
