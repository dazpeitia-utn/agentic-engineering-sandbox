import { calcPrecio } from "./precios.js";

export interface Item {
  nombre: string;
  precio: number;
  cantidad: number;
}

export function totalCarrito(items: Item[], descuento = 0, iva = 0.21): number {
  return items.reduce((total, item) => total + calcPrecio(item.precio, descuento, iva) * item.cantidad, 0);
}
