/** Una vista contada por IP+slug cada ventana (evita inflar con refrescos). */
const WINDOW_MS = 45 * 60 * 1000;
const hits = new Map<string, number>();

function key(ip: string, slug: string): string {
  return `${ip}::${slug}`;
}

export function allowArticleViewIncrement(ip: string, slug: string): boolean {
  const k = key(ip, slug);
  const now = Date.now();
  const last = hits.get(k) ?? 0;
  if (now - last < WINDOW_MS) return false;
  hits.set(k, now);
  return true;
}
