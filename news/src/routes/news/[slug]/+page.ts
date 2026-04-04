import type { NexusContext } from '@nexus_js/server/context';
import { fetchArticleBySlug, recordArticleView } from '../../../lib/cms-api.ts';
import { getLocaleFromCtx, newsPageCopy, pathWithLang } from '../../../lib/i18n.ts';

function tagHref(ctx: NexusContext, tagSlug: string): string {
  return pathWithLang(ctx, '/tag/' + encodeURIComponent(tagSlug));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function imgSrcOk(url: string | null | undefined): url is string {
  if (!url?.trim()) return false;
  return /^https?:\/\//i.test(url.trim());
}

export async function render(ctx: NexusContext) {
  const slug = ctx.params.slug ?? '';
  const article = await fetchArticleBySlug(slug);

  if (!article) {
    ctx.notFound();
  }

  recordArticleView(slug);

  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const backHref = pathWithLang(ctx, '/');

  const meta = [
    article.publishedAt ?
      new Date(article.publishedAt).toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'short',
      })
    : null,
    article.readTimeMinutes != null ? `${article.readTimeMinutes} ${copy.minRead}` : null,
    article.author?.name,
  ]
    .filter(Boolean)
    .join(' · ');

  const tags =
    article.tags?.length ?
      `<ul class="np-tags">${article.tags.map((t) => `<li><a class="np-tag" href="${esc(tagHref(ctx, t.slug))}">${esc(t.name)}</a></li>`).join('')}</ul>`
    : '';

  const cover =
    imgSrcOk(article.coverImage) ?
      `<figure class="np-story-hero">
  <img src="${esc(article.coverImage!.trim())}" alt="${esc(article.coverImageAlt || article.title)}" width="1400" height="787" loading="eager" decoding="async">
  <figcaption class="np-story-cap">${esc(copy.coverPhoto)}</figcaption>
</figure>`
    : '';

  /** CMS content is trusted (same backend). For untrusted HTML, sanitize first. */
  const bodyHtml = article.content;

  const html = `<article class="np-story" lang="${esc(locale === 'en' ? 'en' : locale === 'es' ? 'es' : 'pt')}">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Newsreader:ital,opsz,wght@0,6..72,400..800;1,6..72,400..600&display=swap');
  .np-story {
    --np-paper: #ffffff;
    --np-ink: #0f172a;
    --np-muted: #64748b;
    --np-rule: #e2e8f0;
    --np-accent: #2563eb;
    --np-headline: "Newsreader", "Libre Baskerville", Georgia, serif;
    --np-body: "Libre Baskerville", Georgia, "Times New Roman", serif;
    background: var(--np-paper);
    color: var(--np-ink);
    border: 1px solid var(--np-rule);
    border-radius: 2px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 40px rgba(15, 23, 42, 0.04);
    padding: 0;
    max-width: 42rem;
    margin: 0 auto;
    overflow: hidden;
  }
  .np-story-back-wrap {
    padding: 1.25rem 1.25rem 0;
    max-width: 56rem;
    margin: 0 auto;
  }
  @media (min-width: 640px) {
    .np-story-back-wrap { padding: 1.5rem 2rem 0; }
  }
  .np-story-back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--np-body);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--np-accent);
    text-decoration: none;
    border-bottom: 2px solid transparent;
  }
  .np-story-back:hover { border-bottom-color: var(--np-accent); }
  .np-story-hero { margin: 0; }
  .np-story-hero img {
    width: 100%;
    height: auto;
    display: block;
  }
  .np-story-cap {
    margin: 0;
    padding: 0.5rem 1.25rem;
    font-size: 0.65rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--np-muted);
    background: #f8fafc;
    border-bottom: 1px solid var(--np-rule);
  }
  @media (min-width: 640px) {
    .np-story-cap { padding-left: 2rem; padding-right: 2rem; }
  }
  .np-story-head {
    padding: 1.5rem 1.25rem 1.25rem;
    border-bottom: 1px solid var(--np-rule);
  }
  @media (min-width: 640px) {
    .np-story-head { padding: 2rem 2rem 1.5rem; }
  }
  .np-story-title {
    margin: 0 0 1rem;
    font-family: var(--np-headline);
    font-weight: 800;
    font-size: clamp(1.65rem, 4vw, 2.5rem);
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .np-story-meta {
    margin: 0;
    font-family: var(--np-body);
    font-size: 0.85rem;
    font-style: italic;
    color: var(--np-muted);
    line-height: 1.5;
  }
  .np-tags {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .np-tag {
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--np-rule);
    font-family: var(--np-body);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--np-muted);
    background: #f8fafc;
    border-radius: 2px;
  }
  .np-tag:hover { color: var(--np-accent); border-color: var(--np-accent); }
  .np-story-deck {
    margin: 0;
    padding: 1.25rem 1.25rem 0;
    font-family: var(--np-body);
    font-size: 1.05rem;
    line-height: 1.6;
    color: var(--np-muted);
  }
  @media (min-width: 640px) {
    .np-story-deck { padding: 1.5rem 2rem 0; }
  }
  .np-story-body {
    padding: 1.25rem 1.25rem 2.5rem;
    font-family: var(--np-body);
    font-size: 1.02rem;
    line-height: 1.85;
    color: var(--np-ink);
  }
  @media (min-width: 640px) {
    .np-story-body { padding: 1.5rem 2rem 3rem; column-count: 1; }
  }
  @media (min-width: 900px) {
    .np-story-body {
      column-count: 2;
      column-gap: 2rem;
      column-rule: 1px solid var(--np-rule);
    }
  }
  .np-story-body :where(p) {
    margin: 0 0 1.1rem;
    break-inside: avoid;
  }
  .np-story-body > p:first-of-type::first-letter {
    float: left;
    font-family: var(--np-headline);
    font-size: 3.25rem;
    line-height: 0.82;
    font-weight: 700;
    margin: 0.08em 0.12em 0 0;
    color: var(--np-accent);
  }
  .np-story-body :where(h2) {
    font-family: var(--np-headline);
    font-size: 1.35rem;
    font-weight: 700;
    margin: 1.75rem 0 0.75rem;
    break-after: avoid;
    column-span: all;
  }
  .np-story-body :where(h3) {
    font-family: var(--np-headline);
    font-size: 1.1rem;
    margin: 1.35rem 0 0.5rem;
    break-after: avoid;
  }
  .np-story-body :where(blockquote) {
    margin: 1.25rem 0;
    padding: 0.5rem 0 0.5rem 1rem;
    border-left: 3px solid var(--np-accent);
    font-style: italic;
    color: var(--np-muted);
    break-inside: avoid;
  }
  .np-story-body :where(a) { color: var(--np-accent); }
  .np-story-body :where(ul, ol) { margin: 0 0 1rem; padding-left: 1.25rem; }
  .np-story-body :where(img) { max-width: 100%; height: auto; border: 1px solid var(--np-rule); border-radius: 2px; column-span: all; }
</style>
  <div class="np-story-back-wrap">
    <a class="np-story-back" href="${esc(backHref)}">← ${esc(copy.backToNews)}</a>
  </div>
  ${cover}
  <header class="np-story-head">
    <h1 class="np-story-title">${esc(article.title)}</h1>
    <p class="np-story-meta">${esc(meta)}</p>
    ${tags}
  </header>
  ${article.excerpt ? `<p class="np-story-deck">${esc(article.excerpt)}</p>` : ''}
  <div class="np-story-body">${bodyHtml}</div>
</article>`;

  return {
    html,
    css: false,
    hasIslands: false,
  };
}
