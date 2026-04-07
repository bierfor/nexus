/**
 * Nexus Metadata API — type-safe, XSS-safe `<head>` metadata for .nx pages.
 *
 * Usage in a page or layout frontmatter (server block):
 *
 * ```ts
 * export const nxPretext = async (ctx) => {
 *   return {
 *     meta: defineMetadata({
 *       title: ctx.params.name + ' — My App',
 *       description: 'Profile page for ' + ctx.params.name,
 *       og: { image: 'https://cdn.example.com/og.png' },
 *     }),
 *   };
 * };
 * ```
 *
 * In the layout template:
 *
 * ```html
 * <head>
 *   {{{ pretext.meta?.html ?? '' }}}
 * </head>
 * ```
 *
 * All dynamic values are HTML-escaped before injection to prevent XSS via
 * user-controlled title / description strings.
 */

export interface MetadataInput {
  /** Page title — becomes `<title>` and `og:title`. */
  title?: string;
  /** Short description — becomes `<meta name="description">` and `og:description`. */
  description?: string;
  /** Canonical URL for this page. */
  canonical?: string;
  /** Robots directive (default: 'index, follow'). */
  robots?: string;
  /** Open Graph fields. */
  og?: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
    url?: string;
    siteName?: string;
  };
  /** Twitter card fields. */
  twitter?: {
    card?: 'summary' | 'summary_large_image' | 'app' | 'player';
    title?: string;
    description?: string;
    image?: string;
    creator?: string;
    site?: string;
  };
  /** Arbitrary additional `<meta>` tags. */
  extra?: Array<{ name?: string; property?: string; content: string }>;
}

export interface MetadataResult {
  /** Raw HTML string safe for injection into `<head>`. All values are escaped. */
  html: string;
  /** Original input (for programmatic access). */
  input: MetadataInput;
}

// ── HTML escape ───────────────────────────────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&':  '&amp;',
  '<':  '&lt;',
  '>':  '&gt;',
  '"':  '&quot;',
  "'":  '&#x27;',
  '`':  '&#x60;',
};

/**
 * Escapes a string for safe use inside HTML attribute values and text content.
 * Prevents XSS when injecting user-controlled strings into `<meta>` tags.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
}

function attr(value: string | undefined): string {
  return value !== undefined ? escapeHtml(value) : '';
}

function metaTag(nameAttr: string, content: string | undefined): string {
  if (!content) return '';
  return `<meta ${nameAttr}="${escapeHtml(nameAttr.split('=')[0] ?? nameAttr)}" content="${attr(content)}">`;
}

function ogTag(property: string, content: string | undefined): string {
  if (!content) return '';
  return `<meta property="${property}" content="${attr(content)}">`;
}

function twitterTag(name: string, content: string | undefined): string {
  if (!content) return '';
  return `<meta name="${name}" content="${attr(content)}">`;
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Builds XSS-safe `<head>` metadata from a typed descriptor.
 *
 * @returns `MetadataResult` — inject `.html` into your layout's `<head>`.
 *
 * @example
 * ```ts
 * const meta = defineMetadata({
 *   title: 'My Page',
 *   description: 'Welcome to my site',
 *   og: { image: 'https://cdn.example.com/og.png', type: 'website' },
 *   twitter: { card: 'summary_large_image', creator: '@myhandle' },
 * });
 * // meta.html → safe HTML string for <head>
 * ```
 */
export function defineMetadata(input: MetadataInput): MetadataResult {
  const lines: string[] = [];

  // Title
  if (input.title) {
    lines.push(`<title>${escapeHtml(input.title)}</title>`);
  }

  // Standard meta
  if (input.description) {
    lines.push(`<meta name="description" content="${attr(input.description)}">`);
  }
  if (input.robots) {
    lines.push(`<meta name="robots" content="${attr(input.robots)}">`);
  }
  if (input.canonical) {
    lines.push(`<link rel="canonical" href="${attr(input.canonical)}">`);
  }

  // Open Graph
  if (input.og) {
    const og = input.og;
    lines.push(ogTag('og:title',       og.title       ?? input.title));
    lines.push(ogTag('og:description', og.description ?? input.description));
    lines.push(ogTag('og:image',       og.image));
    lines.push(ogTag('og:type',        og.type ?? 'website'));
    lines.push(ogTag('og:url',         og.url));
    lines.push(ogTag('og:site_name',   og.siteName));
  }

  // Twitter
  if (input.twitter) {
    const tw = input.twitter;
    lines.push(twitterTag('twitter:card',        tw.card ?? 'summary'));
    lines.push(twitterTag('twitter:title',       tw.title       ?? input.title));
    lines.push(twitterTag('twitter:description', tw.description ?? input.description));
    lines.push(twitterTag('twitter:image',       tw.image));
    lines.push(twitterTag('twitter:creator',     tw.creator));
    lines.push(twitterTag('twitter:site',        tw.site));
  }

  // Extra tags
  if (input.extra) {
    for (const tag of input.extra) {
      const keyAttr = tag.property
        ? `property="${escapeHtml(tag.property)}"`
        : `name="${escapeHtml(tag.name ?? '')}"`;
      lines.push(`<meta ${keyAttr} content="${attr(tag.content)}">`);
    }
  }

  const html = lines.filter(Boolean).join('\n  ');
  return { html, input };
}
