/**
 * Noticias reales vía la API pública de Hacker News (Firebase).
 * Sin API key — ideal para demos SSR.
 *
 * @see https://github.com/HackerNews/API
 */
const HN = 'https://hacker-news.firebaseio.com/v0';

/**
 * @param {number} limit
 * @returns {Promise<Array<{ id: string; tag: string; title: string; excerpt: string; date: string; href: string }>>}
 */
export async function fetchTopStories(limit = 15) {
  try {
    const listRes = await fetch(`${HN}/topstories.json`, {
      headers: { accept: 'application/json' },
    });
    if (!listRes.ok) throw new Error(`topstories ${listRes.status}`);
    /** @type {number[]} */
    const ids = await listRes.json();
    const slice = ids.slice(0, Math.min(limit, 30));

    const items = await Promise.all(
      slice.map(async (id) => {
        const r = await fetch(`${HN}/item/${id}.json`);
        if (!r.ok) return null;
        return r.json();
      }),
    );

    return items
      .filter((it) => it && it.type === 'story' && typeof it.title === 'string')
      .map((it) => {
        const score = it.score ?? 0;
        const by = it.by ?? '?';
        const com = it.descendants ?? 0;
        const t = it.time ?? 0;
        const date = t ? new Date(t * 1000).toISOString().slice(0, 10) : '';
        const href =
          typeof it.url === 'string' && it.url
            ? it.url
            : `https://news.ycombinator.com/item?id=${it.id}`;
        return {
          id: String(it.id),
          tag: 'Hacker News',
          title: it.title,
          excerpt: `${score} pts · por ${by} · ${com} comentarios`,
          date,
          href,
        };
      });
  } catch (e) {
    console.error('[hn-news] fetchTopStories:', e);
    return [];
  }
}
