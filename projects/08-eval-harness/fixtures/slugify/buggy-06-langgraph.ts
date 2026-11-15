function slugify(text: string): string {
  // Convertir a minúsculas
  let slug = text.toLowerCase();

  // Reemplazar caracteres con acentos por sin acentos y ñ por n
  const from = 'áàäâãªéèëêíìïîóòöôõúùüûñç';
  const to = 'aaaaaeeeeiiiiooooouuuuunnc';
  for (let i = 0; i < from.length; i++) {
    slug = slug.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i));
  }

  // Reemplazar espacios y signos de puntuación por guiones
  slug = slug.replace(/[^a-z0-9]+/g, '-');

  // Quitar guiones al principio y al final
  slug = slug.replace(/^-+|-+$/g, '');

  // Verificar si el slug resultante es vacío
  if (slug === '') {
    throw new Error('El resultado del slug está vacío');
  }

  return slug;
}

export default slugify;
