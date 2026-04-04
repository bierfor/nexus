/**
 * Snippet-oriented meta helpers — copy still comes from CMS (no invented claims).
 */

/** Truncate at word boundary for meta description / SERP snippet (~150–160 chars). */
export function metaDescriptionFromSummary(text: string, max = 158): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…';
}
