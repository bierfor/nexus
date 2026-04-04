/**
 * Lee ADMIN_SECRET para rutas API (servidor). Quita espacios y comillas típicas de .env.
 */
export function getAdminSecret(): string | undefined {
  const raw = process.env.ADMIN_SECRET;
  if (raw == null) return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || undefined;
}
