export function calculateTotal(price: number, tax: number): number {
  // BUG INTENCIONAL: Aquí se está restando el impuesto en lugar de sumarlo.
  // El comportamiento esperado es que retorne price + tax.
  return price - tax;
}