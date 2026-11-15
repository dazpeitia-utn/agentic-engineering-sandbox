function slugify(text: string): string {
    // Convertir a minúsculas
    let slug = text.toLowerCase();

    // Reemplazar ñ con n y eliminar acentos
    slug = slug.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ñ/g, 'n');

    // Reemplazar espacios y signos de puntuación por guiones
    slug = slug.replace(/[^\w]+/g, '-');

    // Eliminar guiones al inicio o fin y guiones repetidos
    slug = slug.replace(/^[-]+|[-]+$/g, '').replace(/--+/g, '-');

    // Lanzar error si el resultado es una cadena vacía
    if (!slug) {
        throw new Error('El resultado del slug está vacío');
    }
    
    return slug;
}

export default slugify;
