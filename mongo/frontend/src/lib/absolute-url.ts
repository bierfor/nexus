/** Construye URL absoluta para metadatos, JSON-LD y enlaces canónicos. */
export function absoluteUrl(siteBase: string, pathOrUrl: string): string {
  const b = siteBase.replace(/\/$/, "");
  const p = pathOrUrl.trim();
  if (!p) return b;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  if (p.startsWith("//")) return `https:${p}`;
  return p.startsWith("/") ? `${b}${p}` : `${b}/${p}`;
}
