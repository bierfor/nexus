/**
 * Nexus Head — Reactive SEO metadata manager.
 *
 * The problem with Islands Architecture:
 *   Metadata lives in <head> but components are islands deep in <body>.
 *   A product detail island needs to update the page <title> and og:image,
 *   but it has no easy DOM path to <head>.
 *
 * Nexus Head solves this with two mechanisms:
 *
 *   1. SERVER: `defineHead()` in a component's server block injects metadata
 *              statically into the SSR'd HTML — perfect for crawlers.
 *
 *   2. CLIENT: `useHead()` in an island script reactively updates <head>
 *              tags when state changes — perfect for SPAs and dynamic routes.
 *
 * Usage (server block — static, zero JS):
 *   ---
 *   defineHead({
 *     title: `${post.title} | My Blog`,
 *     description: post.excerpt,
 *     og: { image: post.coverImage, type: 'article' },
 *     canonical: `/blog/${post.slug}`,
 *   });
 *   ---
 *
 * Usage (island script — reactive):
 *   <script>
 *     let query = $state('');
 *     useHead(() => ({ title: `Search: ${query.value}` }));
 *   </script>
 */

import { $effect } from '@nexus/runtime';

export interface HeadMeta {
  /** Page title (also sets og:title and twitter:title by default) */
  title?: string;
  /** Append site name: "Post Title | My Site" */
  titleTemplate?: string;
  description?: string;
  keywords?: string | string[];
  canonical?: string;
  robots?: string | RobotsDirective;
  /** Viewport meta */
  viewport?: string;
  /** Open Graph metadata */
  og?: OpenGraphMeta;
  /** Twitter Card metadata */
  twitter?: TwitterMeta;
  /** JSON-LD structured data */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Arbitrary <link> tags */
  links?: LinkTag[];
  /** Arbitrary <meta> tags */
  metas?: MetaTag[];
  /** <script> tags to inject into head */
  scripts?: ScriptTag[];
  /** Theme color */
  themeColor?: string;
  /** Favicon href */
  favicon?: string;
}

export interface OpenGraphMeta {
  title?: string;
  description?: string;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  url?: string;
  type?: 'website' | 'article' | 'product' | 'profile' | string;
  siteName?: string;
  locale?: string;
}

export interface TwitterMeta {
  card?: 'summary' | 'summary_large_image' | 'app' | 'player';
  site?: string;
  creator?: string;
  title?: string;
  description?: string;
  image?: string;
  imageAlt?: string;
}

export interface LinkTag {
  rel: string;
  href: string;
  type?: string;
  hreflang?: string;
  sizes?: string;
  crossorigin?: string;
  [key: string]: string | undefined;
}

export interface MetaTag {
  name?: string;
  property?: string;
  httpEquiv?: string;
  content: string;
  charset?: string;
}

export interface ScriptTag {
  src?: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
  content?: string;
}

export type RobotsDirective = {
  index?: boolean;
  follow?: boolean;
  noarchive?: boolean;
  nosnippet?: boolean;
};

// ── Server-side: collect metadata for SSR injection ───────────────────────────

const _headStack: HeadMeta[] = [];

/**
 * Called in server blocks to define page metadata.
 * Collected during SSR and injected into <head>.
 */
export function defineHead(meta: HeadMeta): void {
  _headStack.push(meta);
}

/**
 * Collects and clears the head stack for the current request.
 * Called by the renderer to inject <head> content.
 */
export function flushHead(): HeadMeta[] {
  const heads = [..._headStack];
  _headStack.length = 0;
  return heads;
}

/**
 * Renders collected HeadMeta into <head> HTML string.
 * Called by the SSR renderer to inject into the document.
 */
export function renderHeadToString(metas: HeadMeta[]): string {
  // Merge all head metas (later entries override earlier)
  const merged = mergeMetas(metas);
  return buildHeadHTML(merged);
}

// ── Client-side: reactive head updates ───────────────────────────────────────

/** Tracks applied head elements for cleanup */
const appliedElements: Element[] = [];

/**
 * Reactively updates <head> metadata from an island.
 * Uses $effect to re-run whenever dependencies change.
 *
 * @param meta - A function returning HeadMeta (can reference $state signals)
 */
export function useHead(meta: () => HeadMeta): void {
  if (typeof document === 'undefined') return;

  $effect(() => {
    const resolved = meta();
    applyHeadToDom(resolved);
  });
}

function applyHeadToDom(meta: HeadMeta): void {
  // Clean up previously applied elements
  for (const el of appliedElements) el.remove();
  appliedElements.length = 0;

  const head = document.head;

  const inject = (el: Element): void => {
    head.appendChild(el);
    appliedElements.push(el);
  };

  // Title
  if (meta.title) {
    const title = meta.titleTemplate
      ? meta.titleTemplate.replace('%s', meta.title)
      : meta.title;
    document.title = title;
  }

  // Description
  if (meta.description) {
    inject(createMeta({ name: 'description', content: meta.description }));
  }

  // Keywords
  if (meta.keywords) {
    const kw = Array.isArray(meta.keywords) ? meta.keywords.join(', ') : meta.keywords;
    inject(createMeta({ name: 'keywords', content: kw }));
  }

  // Canonical
  if (meta.canonical) {
    inject(createLink({ rel: 'canonical', href: meta.canonical }));
  }

  // Robots
  if (meta.robots) {
    const content = typeof meta.robots === 'string'
      ? meta.robots
      : robotsToString(meta.robots);
    inject(createMeta({ name: 'robots', content }));
  }

  // Open Graph
  if (meta.og) {
    const og = meta.og;
    const title = og.title ?? meta.title;
    if (title) inject(createMeta({ property: 'og:title', content: title }));
    const desc = og.description ?? meta.description;
    if (desc) inject(createMeta({ property: 'og:description', content: desc }));
    if (og.image) inject(createMeta({ property: 'og:image', content: og.image }));
    if (og.imageAlt) inject(createMeta({ property: 'og:image:alt', content: og.imageAlt }));
    if (og.imageWidth) inject(createMeta({ property: 'og:image:width', content: String(og.imageWidth) }));
    if (og.imageHeight) inject(createMeta({ property: 'og:image:height', content: String(og.imageHeight) }));
    if (og.url) inject(createMeta({ property: 'og:url', content: og.url }));
    if (og.type) inject(createMeta({ property: 'og:type', content: og.type }));
    if (og.siteName) inject(createMeta({ property: 'og:site_name', content: og.siteName }));
    if (og.locale) inject(createMeta({ property: 'og:locale', content: og.locale }));
  }

  // Twitter
  if (meta.twitter) {
    const t = meta.twitter;
    if (t.card) inject(createMeta({ name: 'twitter:card', content: t.card }));
    if (t.site) inject(createMeta({ name: 'twitter:site', content: t.site }));
    if (t.creator) inject(createMeta({ name: 'twitter:creator', content: t.creator }));
    const title = t.title ?? meta.title;
    if (title) inject(createMeta({ name: 'twitter:title', content: title }));
    const desc = t.description ?? meta.description;
    if (desc) inject(createMeta({ name: 'twitter:description', content: desc }));
    if (t.image) inject(createMeta({ name: 'twitter:image', content: t.image }));
    if (t.imageAlt) inject(createMeta({ name: 'twitter:image:alt', content: t.imageAlt }));
  }

  // JSON-LD
  if (meta.jsonLd) {
    const schemas = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    for (const schema of schemas) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(schema);
      inject(script);
    }
  }

  // Theme color
  if (meta.themeColor) {
    inject(createMeta({ name: 'theme-color', content: meta.themeColor }));
  }

  // Arbitrary metas
  for (const m of meta.metas ?? []) {
    inject(createMeta(m));
  }

  // Arbitrary links
  for (const l of meta.links ?? []) {
    inject(createLink(l));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMeta(attrs: MetaTag): HTMLMetaElement {
  const el = document.createElement('meta');
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) el.setAttribute(k, String(v));
  }
  return el;
}

function createLink(attrs: LinkTag): HTMLLinkElement {
  const el = document.createElement('link');
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) el.setAttribute(k, v);
  }
  return el;
}

function robotsToString(r: RobotsDirective): string {
  const parts: string[] = [];
  if (r.index === false) parts.push('noindex');
  else parts.push('index');
  if (r.follow === false) parts.push('nofollow');
  else parts.push('follow');
  if (r.noarchive) parts.push('noarchive');
  if (r.nosnippet) parts.push('nosnippet');
  return parts.join(', ');
}

function mergeMetas(metas: HeadMeta[]): HeadMeta {
  return metas.reduce<HeadMeta>((acc, m) => ({
    ...acc,
    ...m,
    og: { ...acc.og, ...m.og },
    twitter: { ...acc.twitter, ...m.twitter },
    metas: [...(acc.metas ?? []), ...(m.metas ?? [])],
    links: [...(acc.links ?? []), ...(m.links ?? [])],
    scripts: [...(acc.scripts ?? []), ...(m.scripts ?? [])],
  }), {});
}

function buildHeadHTML(meta: HeadMeta): string {
  const tags: string[] = [];

  if (meta.viewport) {
    tags.push(`<meta name="viewport" content="${esc(meta.viewport)}">`);
  }

  if (meta.title) {
    const title = meta.titleTemplate
      ? meta.titleTemplate.replace('%s', meta.title)
      : meta.title;
    tags.push(`<title>${esc(title)}</title>`);
    tags.push(`<meta property="og:title" content="${esc(title)}">`);
    tags.push(`<meta name="twitter:title" content="${esc(title)}">`);
  }

  if (meta.description) {
    tags.push(`<meta name="description" content="${esc(meta.description)}">`);
    tags.push(`<meta property="og:description" content="${esc(meta.description)}">`);
    tags.push(`<meta name="twitter:description" content="${esc(meta.description)}">`);
  }

  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${esc(meta.canonical)}">`);
    tags.push(`<meta property="og:url" content="${esc(meta.canonical)}">`);
  }

  if (meta.og?.image) {
    tags.push(`<meta property="og:image" content="${esc(meta.og.image)}">`);
    tags.push(`<meta name="twitter:image" content="${esc(meta.og.image)}">`);
    tags.push(`<link rel="preload" as="image" href="${esc(meta.og.image)}">`);
  }

  if (meta.jsonLd) {
    const schemas = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    for (const s of schemas) {
      tags.push(`<script type="application/ld+json">${JSON.stringify(s)}</script>`);
    }
  }

  if (meta.themeColor) {
    tags.push(`<meta name="theme-color" content="${esc(meta.themeColor)}">`);
  }

  if (meta.favicon) {
    tags.push(`<link rel="icon" href="${esc(meta.favicon)}">`);
  }

  for (const m of meta.metas ?? []) {
    const attrs = Object.entries(m)
      .map(([k, v]) => `${k}="${esc(String(v))}"`)
      .join(' ');
    tags.push(`<meta ${attrs}>`);
  }

  for (const l of meta.links ?? []) {
    const attrs = Object.entries(l)
      .map(([k, v]) => `${k}="${esc(String(v))}"`)
      .join(' ');
    tags.push(`<link ${attrs}>`);
  }

  return tags.join('\n  ');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
