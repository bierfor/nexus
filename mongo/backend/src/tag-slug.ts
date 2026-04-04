/**
 * Convierte entradas del admin (#Hashtag, CamelCase, slugs ya válidos) al slug usado en BD.
 */
export function normalizeTagSlugInput(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("#")) s = s.slice(1).trim();
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = s
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
  s = s.toLowerCase();
  s = s.replace(/[\s_]+/g, "-");
  s = s.replace(/[^a-z0-9-]+/g, "");
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s;
}

export function normalizeTagSlugList(slugs: string[]): string[] {
  const out = slugs.map(normalizeTagSlugInput).filter(Boolean);
  return [...new Set(out)];
}

/** Nombre legible por defecto al crear una etiqueta nueva desde el slug (p. ej. ia-2026 → Ia 2026). */
export function defaultTagDisplayNameFromSlug(slug: string): string {
  const label = slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
  return label || slug;
}
