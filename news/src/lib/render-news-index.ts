import type { NexusContext } from '@nexus_js/server/context';
import type { CmsArticleListItem } from './cms-api.ts';
import { fetchFlashNews, fetchHero, fetchPublishedArticles } from './cms-api.ts';
import {
  getLocaleFromCtx,
  layoutCopy,
  localizeAppHref,
  newsPageCopy,
  pathWithLang,
} from './i18n.ts';
import { websiteJsonLd } from './seo-jsonld.ts';
import { heroMarkdownToParagraphs } from './rich-text.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function imgSrcOk(url: string | null | undefined): url is string {
  if (!url?.trim()) return false;
  return /^https?:\/\//i.test(url.trim());
}

function formatEditionDate(locale: string, iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function metaLine(a: CmsArticleListItem, copy: ReturnType<typeof newsPageCopy>): string {
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

/** Front page: newspaper index (used at `/` and redirected from `/news`). */
export async function renderNewsIndex(ctx: NexusContext) {
  const heroSlug = process.env.NEXUS_HERO_SLUG?.trim() || 'home';
  const [articles, hero, flashItems] = await Promise.all([
    fetchPublishedArticles(),
    fetchHero(heroSlug),
    fetchFlashNews(10),
  ]);
  const locale = getLocaleFromCtx(ctx);
  const copy = newsPageCopy(locale);
  const lc = layoutCopy(locale);
  const graphqlUrl = process.env.NEXUS_GRAPHQL_URL?.trim() || 'http://127.0.0.1:4000/graphql';
  const siteUrl =
    process.env.NEXUS_PUBLIC_SITE_URL?.trim()?.replace(/\/$/, '') || ctx.url.origin;
  const jsonLd = `<script type="application/ld+json">${websiteJsonLd({
    siteUrl,
    name:        lc.ogSiteName,
    description: lc.homeMetaDescription,
    locale,
  })}</script>`;
  const localeTag = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'pt-BR';

  const [lead, ...rest] = articles;

  const leadHtml = lead
    ? (() => {
        const href = pathWithLang(ctx, '/news/' + encodeURIComponent(lead.slug));
        const fig = imgSrcOk(lead.coverImage)
          ? `<figure class="np-lead-fig">
  <img src="${esc(lead.coverImage!.trim())}" alt="${esc(lead.coverImageAlt || lead.title)}" width="1200" height="675" loading="eager" decoding="async">
  <figcaption class="np-cap">${esc(copy.coverPhoto)}</figcaption>
</figure>`
          : '';
        return `<article class="np-lead" aria-labelledby="np-lead-title">
  <a class="np-lead-link" href="${esc(href)}">
    ${fig}
    <div class="np-lead-text">
      <p class="np-kicker">${esc(copy.indexKicker)}</p>
      <h2 id="np-lead-title" class="np-lead-title">${esc(lead.title)}</h2>
      ${lead.excerpt ? `<p class="np-deck">${esc(lead.excerpt)}</p>` : ''}
      <p class="np-byline">${esc(metaLine(lead, copy))}</p>
    </div>
  </a>
</article>`;
      })()
    : '';

  const tiles = rest
    .map((a) => {
      const href = pathWithLang(ctx, '/news/' + encodeURIComponent(a.slug));
      const thumb = imgSrcOk(a.coverImage)
        ? `<figure class="np-tile-fig">
  <img src="${esc(a.coverImage!.trim())}" alt="${esc(a.coverImageAlt || a.title)}" width="640" height="360" loading="lazy" decoding="async">
</figure>`
        : `<div class="np-tile-fallback" aria-hidden="true"></div>`;
      return `<a class="np-tile" href="${esc(href)}">
  ${thumb}
  <div class="np-tile-body">
    <h3 class="np-tile-title">${esc(a.title)}</h3>
    ${a.excerpt ? `<p class="np-tile-excerpt">${esc(a.excerpt)}</p>` : ''}
    <p class="np-tile-meta">${esc(metaLine(a, copy))}</p>
  </div>
</a>`;
    })
    .join('\n');

  const editionDate =
    articles[0]?.publishedAt ?
      formatEditionDate(localeTag, articles[0].publishedAt)
    : formatEditionDate(localeTag, new Date().toISOString());

  const empty =
    articles.length === 0 ?
      `<div class="np-empty">
  <h2 class="np-empty-title">${esc(copy.emptyTitle)}</h2>
  <p class="np-empty-body">${esc(copy.emptyLead)}</p>
  <p class="np-empty-tech"><code class="np-mono">${esc(graphqlUrl)}</code></p>
</div>`
    : '';

  const moreBlock =
    rest.length > 0 ?
      `<div class="np-more">
  <h2 class="np-more-title">${esc(copy.moreHeadlines)}</h2>
  <div class="np-grid">${tiles}</div>
</div>`
    : '';

  const heroHtml =
    hero ?
      (() => {
        const h = hero;
        const fig =
          imgSrcOk(h.imageUrl) ?
            `<div class="np-hero__fig">
  <img src="${esc(h.imageUrl!.trim())}" alt="" width="1200" height="800" loading="eager" decoding="async">
</div>`
          : '';
        const bodyHtml = heroMarkdownToParagraphs(h.body);
        const secHtml =
          h.bodySecondary ? `<div class="np-hero__sec">${heroMarkdownToParagraphs(h.bodySecondary)}</div>` : '';
        const ctaLabel = esc(h.footerCtaLabel || copy.heroCtaFallback);
        const ctaHref = h.footerCtaHref ? localizeAppHref(ctx, h.footerCtaHref) : pathWithLang(ctx, '/');
        const sub = h.subheadline ? `<p class="np-hero__sub">${esc(h.subheadline)}</p>` : '';
        const kick = h.kicker ? `<p class="np-hero__kicker">${esc(h.kicker)}</p>` : '';
        return `<section class="np-hero" aria-labelledby="np-hero-h">
  <div class="np-hero__grid">
    ${fig}
    <div class="np-hero__text">
      ${kick}
      <h2 id="np-hero-h" class="np-hero__hl">${esc(h.headline)}</h2>
      ${sub}
      <div class="np-hero__body">${bodyHtml}</div>
      ${secHtml}
      <a class="np-hero__cta" href="${esc(ctaHref)}">${ctaLabel}</a>
    </div>
  </div>
</section>`;
      })()
    : '';

  const flashStripHtml =
    flashItems.length > 0 ?
      (() => {
        const stripLabel = esc(copy.flashStripTitle);
        const moreHref = esc(pathWithLang(ctx, '/flash'));
        const moreLabel = esc(copy.flashStripMore);
        const cards = flashItems
          .slice(0, 8)
          .map((f) => {
            const href = pathWithLang(ctx, '/flash/' + encodeURIComponent(f.slug));
            return `<a class="np-flash-card" href="${esc(href)}">
  <span class="np-flash-card__t">${esc(f.title)}</span>
  <span class="np-flash-card__s">${esc(f.summary.slice(0, 140))}${f.summary.length > 140 ? '…' : ''}</span>
</a>`;
          })
          .join('\n');
        return `<section class="np-flash-strip" aria-label="${stripLabel}">
  <div class="np-flash-strip__head">
    <h2 class="np-flash-strip__title">${stripLabel}</h2>
    <a class="np-flash-strip__more" href="${moreHref}">${moreLabel}</a>
  </div>
  <div class="np-flash-strip__scroll">${cards}</div>
</section>`;
      })()
    : '';

  const html = `<div class="np-front">
${jsonLd}
<style>
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Newsreader:ital,opsz,wght@0,6..72,400..800;1,6..72,400..600&display=swap');
  .np-front {
    --np-paper: #ffffff;
    --np-ink: #0f172a;
    --np-muted: #64748b;
    --np-rule: rgba(15, 23, 42, 0.09);
    --np-accent: #0284c7;
    --np-accent-warm: #d97706;
    --np-glow: rgba(14, 165, 233, 0.08);
    --np-headline: "Newsreader", "Libre Baskerville", Georgia, serif;
    --np-body: "Libre Baskerville", Georgia, "Times New Roman", serif;
    position: relative;
    background:
      radial-gradient(ellipse 120% 80% at 50% -15%, var(--np-glow), transparent 58%),
      linear-gradient(180deg, #ffffff 0%, #f8fafc 42%, #f1f5f9 100%);
    color: var(--np-ink);
    border: 1px solid var(--np-rule);
    border-radius: 14px;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.9) inset,
      0 20px 50px rgba(15, 23, 42, 0.06);
    padding: 1.75rem 1.25rem 2.25rem;
    max-width: 56rem;
    margin: 0 auto;
    overflow: hidden;
  }
  .np-front::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.018'/%3E%3C/svg%3E");
    pointer-events: none;
    border-radius: inherit;
    z-index: 0;
  }
  .np-front > * { position: relative; z-index: 1; }
  @media (min-width: 640px) {
    .np-front { padding: 2rem 2rem 2.75rem; }
  }
  .np-masthead {
    text-align: center;
    border-bottom: 1px solid var(--np-rule);
    padding-bottom: 1.15rem;
    margin-bottom: 0.75rem;
  }
  .np-mast-title {
    margin: 0;
    font-family: var(--np-headline);
    font-weight: 700;
    font-size: clamp(1.85rem, 4vw, 2.5rem);
    letter-spacing: -0.03em;
    text-transform: none;
    line-height: 1.08;
    background: linear-gradient(135deg, #0f172a 0%, #334155 38%, #0284c7 95%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .np-mast-psych {
    margin: 0.85rem auto 0;
    max-width: 36rem;
    font-family: var(--np-body);
    font-size: clamp(0.95rem, 2.2vw, 1.05rem);
    line-height: 1.55;
    color: #475569;
    font-style: italic;
    letter-spacing: 0.01em;
  }
  .np-mast-sub {
    margin: 0.65rem 0 0;
    font-family: var(--np-body);
    font-size: 0.68rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--np-accent);
  }
  .np-mast-trust {
    margin: 0.6rem 0 0;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    color: var(--np-muted);
  }
  .np-dateline {
    margin: 0 0 0.75rem;
    text-align: center;
    font-family: var(--np-body);
    font-size: 0.8rem;
    color: var(--np-muted);
    font-style: italic;
    opacity: 0.95;
  }
  .np-rule-thin {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--np-rule) 15%, var(--np-rule) 85%, transparent);
    margin: 0 0 1.5rem;
  }
  .np-lead { margin: 0 0 2rem; }
  .np-lead-link {
    display: grid;
    gap: 1.25rem;
    text-decoration: none;
    color: inherit;
  }
  @media (min-width: 768px) {
    .np-lead-link { grid-template-columns: 1.15fr 1fr; align-items: start; }
  }
  .np-lead-fig { margin: 0; position: relative; }
  .np-lead-fig img {
    width: 100%;
    height: auto;
    display: block;
    border: 1px solid var(--np-rule);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
  }
  .np-cap {
    margin: 0.35rem 0 0;
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--np-muted);
  }
  .np-kicker {
    margin: 0 0 0.35rem;
    font-family: var(--np-body);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--np-accent);
  }
  .np-lead-title {
    margin: 0 0 0.75rem;
    font-family: var(--np-headline);
    font-weight: 700;
    font-size: clamp(1.5rem, 3.2vw, 2.15rem);
    line-height: 1.12;
    letter-spacing: -0.02em;
  }
  .np-lead-link:hover .np-lead-title { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
  .np-deck {
    margin: 0 0 1rem;
    font-family: var(--np-body);
    font-size: 1rem;
    line-height: 1.55;
    color: var(--np-muted);
  }
  .np-byline {
    margin: 0;
    font-family: var(--np-body);
    font-size: 0.78rem;
    color: var(--np-muted);
    border-top: 1px solid var(--np-rule);
    padding-top: 0.75rem;
  }
  .np-more-title {
    margin: 0 0 1rem;
    font-family: var(--np-headline);
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    text-transform: none;
    border-bottom: 1px solid var(--np-rule);
    padding-bottom: 0.5rem;
  }
  .np-grid {
    display: grid;
    gap: 1.25rem;
  }
  @media (min-width: 640px) {
    .np-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (min-width: 900px) {
    .np-grid { grid-template-columns: repeat(3, 1fr); }
  }
  .np-tile {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--np-rule);
    background: rgba(255, 255, 255, 0.92);
    border-radius: 12px;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .np-tile:hover {
    transform: translateY(-3px);
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.1);
    border-color: rgba(14, 165, 233, 0.28);
  }
  .np-tile-fig { margin: 0; aspect-ratio: 16/10; overflow: hidden; background: #e2e8f0; border-radius: 11px 11px 0 0; }
  .np-tile-fig img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .np-tile-fallback { aspect-ratio: 16/10; background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%); border-radius: 11px 11px 0 0; }
  .np-tile-body { padding: 0.85rem 0.9rem 1rem; flex: 1; display: flex; flex-direction: column; }
  .np-tile-title {
    margin: 0 0 0.5rem;
    font-family: var(--np-headline);
    font-weight: 700;
    font-size: 1rem;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .np-tile:hover .np-tile-title { color: var(--np-accent-warm); }
  .np-tile-excerpt {
    margin: 0 0 0.65rem;
    font-family: var(--np-body);
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--np-muted);
    flex: 1;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .np-tile-meta {
    margin: 0;
    font-size: 0.68rem;
    color: var(--np-muted);
    font-family: var(--np-body);
  }
  .np-empty { text-align: center; padding: 2rem 0.5rem; }
  .np-empty-title {
    margin: 0 0 0.75rem;
    font-family: var(--np-headline);
    font-size: 1.35rem;
  }
  .np-empty-body {
    margin: 0 auto 1rem;
    max-width: 32rem;
    font-family: var(--np-body);
    font-size: 0.88rem;
    line-height: 1.65;
    color: var(--np-muted);
  }
  .np-empty-tech { margin: 0; }
  .np-mono {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    word-break: break-all;
    padding: 0.2rem 0.45rem;
    background: #f1f5f9;
    border: 1px solid var(--np-rule);
    border-radius: 6px;
    color: #475569;
  }
  .np-hero {
    margin: 0 0 2rem;
    padding: 0 0 1.75rem;
    border-bottom: 1px solid var(--np-rule);
  }
  .np-hero__grid {
    display: grid;
    gap: 1.5rem;
    align-items: stretch;
  }
  @media (min-width: 768px) {
    .np-hero__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); }
  }
  .np-hero__fig {
    margin: 0;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--np-rule);
    background: #e2e8f0;
    min-height: 12rem;
  }
  .np-hero__fig img {
    width: 100%;
    height: 100%;
    min-height: 12rem;
    object-fit: cover;
    display: block;
  }
  .np-hero__kicker {
    margin: 0 0 0.5rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--np-accent);
  }
  .np-hero__hl {
    margin: 0 0 0.5rem;
    font-family: var(--np-headline);
    font-weight: 700;
    font-size: clamp(1.5rem, 3.5vw, 2.1rem);
    letter-spacing: -0.03em;
    line-height: 1.1;
  }
  .np-hero__sub {
    margin: 0 0 1rem;
    font-size: 1.05rem;
    color: var(--np-muted);
    line-height: 1.45;
  }
  .np-hero__body {
    font-family: var(--np-body);
    font-size: 0.98rem;
    line-height: 1.75;
    color: var(--np-ink);
  }
  .np-hero__body :where(p) { margin: 0 0 0.85rem; }
  .np-hero__sec {
    margin: 1rem 0 0;
    font-size: 0.88rem;
    line-height: 1.65;
    color: var(--np-muted);
  }
  .np-hero__sec :where(p) { margin: 0 0 0.6rem; }
  .np-hero__cta {
    display: inline-flex;
    margin-top: 1.25rem;
    padding: 0.6rem 1.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    color: #ffffff;
    background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 55%, #0369a1 100%);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(14, 165, 233, 0.28);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .np-hero__cta:hover { transform: translateY(-1px); box-shadow: 0 12px 32px rgba(14, 165, 233, 0.35); }
  .np-flash-strip {
    margin: 0 0 2rem;
    padding: 0 0 1.5rem;
    border-bottom: 1px solid var(--np-rule);
  }
  .np-flash-strip__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .np-flash-strip__title {
    margin: 0;
    font-family: var(--np-headline);
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .np-flash-strip__more {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--np-accent);
    text-decoration: none;
  }
  .np-flash-strip__more:hover { text-decoration: underline; }
  .np-flash-strip__scroll {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.35rem;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }
  .np-flash-card {
    flex: 0 0 min(78vw, 17rem);
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 1rem 1.05rem;
    border: 1px solid var(--np-rule);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.95);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }
  .np-flash-card:hover {
    border-color: rgba(14, 165, 233, 0.35);
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.08);
    transform: translateY(-2px);
  }
  .np-flash-card__t {
    font-family: var(--np-headline);
    font-weight: 700;
    font-size: 0.88rem;
    line-height: 1.25;
    letter-spacing: -0.02em;
  }
  .np-flash-card__s {
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--np-muted);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
  ${heroHtml}
  ${flashStripHtml}
  <header class="np-masthead">
    <h1 class="np-mast-title">${esc(copy.masthead)}</h1>
    <p class="np-mast-psych">${esc(copy.homePsychLine)}</p>
    <p class="np-mast-sub">${esc(copy.mastSubTagline)}</p>
    <p class="np-mast-trust">${esc(copy.homeTrustLine)}</p>
  </header>
  <p class="np-dateline">${esc(editionDate)}</p>
  <div class="np-rule-thin" aria-hidden="true"></div>
  ${empty}
  ${leadHtml}
  ${moreBlock}
</div>`;

  return {
    html,
    css: false as const,
    hasIslands: false as const,
  };
}
