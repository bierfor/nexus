/**
 * SSR SEO fields merged into ctx.pretext (root layout reads them in <head>).
 * Values are escaped for safe use in HTML attributes and <title>.
 *
 * Canonical origin logic mirrors `finShPublicOrigin` in graphql.ts — kept here so this
 * module has no relative `.ts` imports (Node ESM preloads cannot resolve extensionless paths).
 */
import type { NexusContext } from '@nexus_js/server';

function publicOrigin(ctx: NexusContext): string {
  const fromVault = ctx.secrets.get('FIN_SH_PUBLIC_ORIGIN');
  if (fromVault !== undefined && fromVault !== '') return fromVault.replace(/\/$/, '');
  const env = process.env['FIN_SH_PUBLIC_ORIGIN']?.replace(/\/$/, '');
  if (env) return env;
  return `${ctx.url.protocol}//${ctx.url.host}`;
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pageSeo(
  ctx: NexusContext,
  opts: {
    title: string;
    description: string;
    /** Comma-separated keywords for `<meta name="keywords">` (minor engines; harmless if omitted). */
    keywords?: string;
    robots?: string;
    ogType?: string;
    /** Absolute URL for Open Graph / Twitter cards (e.g. `${origin}/images/og-cover.svg`) */
    ogImage?: string;
    jsonLd?: Record<string, unknown>;
  },
): Record<string, string | undefined> {
  const origin = publicOrigin(ctx);
  const path = ctx.url.pathname || '/';
  const canonical = origin + path;

  const out: Record<string, string | undefined> = {
    seoTitle: escAttr(opts.title),
    seoDescription: escAttr(opts.description),
    seoCanonical: canonical,
    seoRobots: opts.robots ?? 'index, follow',
    seoOgType: opts.ogType ?? 'website',
  };

  if (opts.keywords !== undefined && opts.keywords.trim() !== '') {
    out.seoKeywords = escAttr(opts.keywords);
  }

  if (opts.ogImage !== undefined && opts.ogImage !== '') {
    out.seoOgImage = escAttr(opts.ogImage);
  }

  if (opts.jsonLd) {
    out.seoJsonLdScript = JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c');
  }

  return out;
}
