// Implementación de referencia, escrita a mano: es el "oráculo" contra el que se comparan las demás.
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca tildes, diéresis, la virgulilla de la ñ y la cedilla de la ç
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error("El resultado del slug está vacío");
  return slug;
}

export default slugify;
