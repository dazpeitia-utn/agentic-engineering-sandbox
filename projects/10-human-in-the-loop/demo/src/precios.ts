export function calcPrecio(base: number, descuento: number, iva: number): number {
  const conDescuento = base - base * descuento;
  return conDescuento + conDescuento * iva;
}
