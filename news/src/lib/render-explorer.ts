import type { NexusContext } from '@nexus_js/server/context';
import {
  articlesForAuthorId,
  articlesForTagSlug,
  fetchAuthors,
  fetchFlashBySlug,
  fetchFlashNews,
  fetchPublishedArticles,
  fetchTags,
  type CmsAuthor,
  type CmsFlashNews,
} from './cms-api.ts';
import { getLocaleFromCtx, newsPageCopy, pathWithLang } from './i18n.ts';
import { NP_PAGE_CSS } from './np-shared.ts';
import { esc } from './rich-text.ts';

function metaLine(
  a: { publishedAt: string | null; readTimeMinutes: number | null; author: { name: string } | null },
  copy: ReturnType<typeof newsPageCopy>,
): string {
  const parts: string[] = [];
  if (a.publishedAt) {
    try {
      parts.push(
        new Date(a.publishedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      );
    } catch {
      /* ignore */
    }
  }
  if (a.readTimeMinutes != null) parts.push(`${a.readTimeMinutes} ${copy.minRead}`);
  if (a.author?.name) parts.push(a.author.name);
  return parts.join(' · ');
}

export async function renderFlashIndex(ctx: NexusContext) {
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const items = await fetchFlashNews(48);

  const cards = items
    .map((f) => {
      const href = pathWithLang(ctx, '/flash/' + encodeURIComponent(f.slug));
      return `<a class="np-card" href="${esc(href)}">
  <h2 class="np-card__title">${esc(f.title)}</h2>
  <p class="np-card__excerpt">${esc(f.summary)}</p>
  <p class="np-card__meta">${esc(copy.explorerSource)}${f.sourceLabel ? ` · ${esc(f.sourceLabel)}` : ''}</p>
</a>`;
    })
    .join('\n');

  const empty = items.length === 0 ? `<p class="np-empty">${esc(copy.explorerEmpty)}</p>` : '';

  const html = `<div class="np-surface">
<style>${NP_PAGE_CSS}</style>
  <h1 class="np-page__title">${esc(copy.explorerFlashTitle)}</h1>
  <p class="np-page__lead">${esc(copy.explorerFlashLead)}</p>
  ${empty}
  <div class="np-abstract-grid">${cards}</div>
</div>`;

  return { html, css: false as const, hasIslands: false as const };
}

export async function renderFlashDetail(ctx: NexusContext) {
  const slug = ctx.params.slug ?? '';
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const item = await fetchFlashBySlug(slug);

  if (!item) {
    ctx.notFound();
  }

  const f = item!;
  const source =
    f.sourceUrl && /^https?:\/\//i.test(f.sourceUrl.trim()) ?
      `<a class="np-flash-src" href="${esc(f.sourceUrl.trim())}" target="_blank" rel="noopener noreferrer">${esc(f.sourceLabel || copy.explorerSource)}</a>`
    : esc(f.sourceLabel || '—');

  const html = `<div class="np-surface np-flash-detail">
<style>${NP_PAGE_CSS}
.np-flash-detail__hack {
  margin: 1.5rem 0 0;
  padding: 1rem 1.15rem;
  border-left: 3px solid var(--np-accent);
  background: #f8fafc;
  font-size: 0.95rem;
  line-height: 1.65;
  color: var(--np-ink);
}
.np-flash-detail__hack-label {
  margin: 0 0 0.35rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--np-muted);
}
.np-flash-src { color: var(--np-accent); text-decoration: none; font-weight: 500; }
.np-flash-src:hover { text-decoration: underline; }
.np-back {
  display: inline-block;
  margin-bottom: 1.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--np-accent);
  text-decoration: none;
}
.np-back:hover { text-decoration: underline; }
</style>
  <a class="np-back" href="${esc(pathWithLang(ctx, '/flash'))}">← ${esc(copy.explorerFlashTitle)}</a>
  <p class="np-page__eyebrow">${esc(copy.explorerFlashTitle)}</p>
  <h1 class="np-page__title">${esc(f.title)}</h1>
  <p class="np-page__lead">${esc(f.summary)}</p>
  <p class="np-card__meta">${esc(copy.explorerSource)}: ${source}</p>
  ${f.hack ? `<div class="np-flash-detail__hack"><p class="np-flash-detail__hack-label">${esc(copy.explorerHack)}</p>${esc(f.hack)}</div>` : ''}
</div>`;

  return { html, css: false as const, hasIslands: false as const };
}

export async function renderTagsIndex(ctx: NexusContext) {
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const tags = await fetchTags();

  const pills = tags
    .map(
      (t) =>
        `<a class="np-pill" href="${esc(pathWithLang(ctx, '/tag/' + encodeURIComponent(t.slug)))}">${esc(t.name)}</a>`,
    )
    .join('\n');

  const empty = tags.length === 0 ? `<p class="np-empty">${esc(copy.explorerEmpty)}</p>` : '';

  const html = `<div class="np-surface">
<style>${NP_PAGE_CSS}
.np-pill-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
</style>
  <h1 class="np-page__title">${esc(copy.explorerTagsTitle)}</h1>
  <p class="np-page__lead">${esc(copy.explorerTagsLead)}</p>
  ${empty}
  <div class="np-pill-row">${pills}</div>
</div>`;

  return { html, css: false as const, hasIslands: false as const };
}

export async function renderTagPage(ctx: NexusContext) {
  const slug = ctx.params.slug ?? '';
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const [articles, tags] = await Promise.all([fetchPublishedArticles(), fetchTags()]);
  const tagRow = tags.find((t) => t.slug === slug);
  if (!tagRow) ctx.notFound();

  const filtered = articlesForTagSlug(articles, slug);

  const cards = filtered
    .map((a) => {
      const href = pathWithLang(ctx, '/news/' + encodeURIComponent(a.slug));
      return `<a class="np-card" href="${esc(href)}">
  <h2 class="np-card__title">${esc(a.title)}</h2>
  ${a.excerpt ? `<p class="np-card__excerpt">${esc(a.excerpt)}</p>` : ''}
  <p class="np-card__meta">${esc(metaLine(a, copy))}</p>
</a>`;
    })
    .join('\n');

  const empty =
    filtered.length === 0 ?
      `<p class="np-empty">${esc(copy.explorerEmpty)}</p>`
    : '';

  const html = `<div class="np-surface">
<style>${NP_PAGE_CSS}
.np-back { display:inline-block;margin-bottom:1rem;font-size:0.8rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--np-accent);text-decoration:none;}
.np-back:hover { text-decoration: underline; }
</style>
  <a class="np-back" href="${esc(pathWithLang(ctx, '/tags'))}">← ${esc(copy.explorerTagsTitle)}</a>
  <p class="np-page__eyebrow">${esc(tagRow.name)}</p>
  <h1 class="np-page__title">${esc(tagRow.name)}</h1>
  <p class="np-page__lead">${esc(copy.explorerStories)}</p>
  ${empty}
  <div class="np-abstract-grid np-abstract-grid--2">${cards}</div>
</div>`;

  return { html, css: false as const, hasIslands: false as const };
}

export async function renderAuthorsIndex(ctx: NexusContext) {
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const authors = await fetchAuthors();

  const cards = authors
    .map((a: CmsAuthor) => {
      const href = pathWithLang(ctx, '/author/' + encodeURIComponent(a.id));
      const bio = a.bio ? esc(a.bio.slice(0, 160)) + (a.bio.length > 160 ? '…' : '') : '';
      const av =
        a.avatarUrl && /^https?:\/\//i.test(a.avatarUrl.trim()) ?
          `<img src="${esc(a.avatarUrl.trim())}" alt="" width="56" height="56" loading="lazy" decoding="async" style="border-radius:999px;object-fit:cover;border:1px solid var(--np-rule)">`
        : `<div style="width:56px;height:56px;border-radius:999px;background:#f1f5f9;border:1px solid var(--np-rule)"></div>`;
      return `<a class="np-card" href="${esc(href)}" style="display:grid;grid-template-columns:auto 1fr;gap:1rem;align-items:start">
  ${av}
  <span>
    <span class="np-card__title" style="display:block">${esc(a.name)}</span>
    ${bio ? `<span class="np-card__excerpt" style="-webkit-line-clamp:4">${bio}</span>` : ''}
  </span>
</a>`;
    })
    .join('\n');

  const empty = authors.length === 0 ? `<p class="np-empty">${esc(copy.explorerEmpty)}</p>` : '';

  const html = `<div class="np-surface">
<style>${NP_PAGE_CSS}</style>
  <h1 class="np-page__title">${esc(copy.explorerAuthorsTitle)}</h1>
  <p class="np-page__lead">${esc(copy.explorerAuthorsLead)}</p>
  ${empty}
  <div class="np-abstract-grid">${cards}</div>
</div>`;

  return { html, css: false as const, hasIslands: false as const };
}

export async function renderAuthorPage(ctx: NexusContext) {
  const id = ctx.params.id ?? '';
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const [authors, articles] = await Promise.all([fetchAuthors(), fetchPublishedArticles()]);
  const author = authors.find((a) => a.id === id);
  if (!author) ctx.notFound();

  const filtered = articlesForAuthorId(articles, id);

  const cards = filtered
    .map((a) => {
      const href = pathWithLang(ctx, '/news/' + encodeURIComponent(a.slug));
      return `<a class="np-card" href="${esc(href)}">
  <h2 class="np-card__title">${esc(a.title)}</h2>
  ${a.excerpt ? `<p class="np-card__excerpt">${esc(a.excerpt)}</p>` : ''}
  <p class="np-card__meta">${esc(metaLine(a, copy))}</p>
</a>`;
    })
    .join('\n');

  const empty =
    filtered.length === 0 ? `<p class="np-empty">${esc(copy.explorerEmpty)}</p>` : '';

  const av =
    author!.avatarUrl && /^https?:\/\//i.test(author!.avatarUrl.trim()) ?
      `<img src="${esc(author!.avatarUrl.trim())}" alt="" width="80" height="80" loading="eager" decoding="async" style="border-radius:999px;object-fit:cover;border:1px solid var(--np-rule)">`
    : `<div style="width:80px;height:80px;border-radius:999px;background:#f1f5f9;border:1px solid var(--np-rule)"></div>`;

  const html = `<div class="np-surface">
<style>${NP_PAGE_CSS}
.np-author-head { display:flex; gap:1.25rem; align-items:flex-start; margin-bottom:1.5rem; }
.np-author-bio { margin:0; font-size:0.95rem; line-height:1.65; color:var(--np-muted); max-width:40rem; }
.np-back { display:inline-block;margin-bottom:1rem;font-size:0.8rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--np-accent);text-decoration:none;}
.np-back:hover { text-decoration: underline; }
</style>
  <a class="np-back" href="${esc(pathWithLang(ctx, '/authors'))}">← ${esc(copy.explorerAuthorsTitle)}</a>
  <div class="np-author-head">
    ${av}
    <div>
      <h1 class="np-page__title" style="margin-bottom:0.35rem">${esc(author!.name)}</h1>
      ${author!.bio ? `<p class="np-author-bio">${esc(author!.bio)}</p>` : ''}
    </div>
  </div>
  <p class="np-page__eyebrow">${esc(copy.explorerStories)}</p>
  ${empty}
  <div class="np-abstract-grid np-abstract-grid--2">${cards}</div>
</div>`;

  return { html, css: false as const, hasIslands: false as const };
}
