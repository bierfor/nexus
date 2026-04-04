/** Minimal markdown for CMS hero bodies: `**bold**` + paragraphs split by blank lines. */

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function inlineBold(raw: string): string {
  const parts = raw.split(/\*\*/);
  return parts.map((p, i) => (i % 2 === 1 ? `<strong>${esc(p)}</strong>` : esc(p))).join('');
}

/** Turns `**a** b` paragraphs into `<p>…</p>`. */
export function heroMarkdownToParagraphs(raw: string): string {
  return raw
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const merged = block.replace(/\n+/g, ' ').trim();
      if (!merged) return '';
      return `<p>${inlineBold(merged)}</p>`;
    })
    .join('');
}
