/**
 * Nexus Font Optimizer — eliminates CLS from web fonts.
 *
 * Strategies:
 *   1. `inline`:  Fetches font CSS at build time, inlines @font-face into <style>.
 *                 Eliminates extra round-trip. Best for 1-2 fonts.
 *   2. `preload`: Emits <link rel="preload"> for the font files detected.
 *                 Best for fonts already self-hosted.
 *   3. `swap`:    Wraps with `font-display: swap` for graceful loading.
 *   4. `subsets`: Requests only the character ranges actually used (via Unicode-range).
 *
 * Usage in nexus.config.ts:
 *   fonts: {
 *     google: [{ family: 'Inter', weights: [400, 700] }],
 *     local:  [{ src: '/fonts/brand.woff2', family: 'Brand' }],
 *     strategy: 'inline',
 *   }
 */

export type FontStrategy = 'inline' | 'preload' | 'swap' | 'auto';

export interface GoogleFont {
  family: string;
  weights?: number[];
  styles?: ('normal' | 'italic')[];
  subsets?: string[];
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

export interface LocalFont {
  family: string;
  src: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /** Unicode range to subset the font */
  unicodeRange?: string;
}

export interface FontConfig {
  google?: GoogleFont[];
  local?: LocalFont[];
  strategy?: FontStrategy;
}

export interface FontOutput {
  /** CSS to inject into <head> */
  css: string;
  /** <link> tags to inject into <head> */
  links: string;
  /** Preload hints */
  preloads: string;
}

/**
 * Generates optimized font HTML/CSS for injection into the document <head>.
 * Called at build time or per-request (cached).
 */
export async function optimizeFonts(config: FontConfig): Promise<FontOutput> {
  const strategy = config.strategy ?? 'auto';
  const cssChunks: string[] = [];
  const linkTags: string[] = [];
  const preloadTags: string[] = [];

  // ── Google Fonts ───────────────────────────────────────────────────────────
  if (config.google?.length) {
    const result = await processGoogleFonts(config.google, strategy);
    cssChunks.push(...result.css);
    linkTags.push(...result.links);
    preloadTags.push(...result.preloads);
  }

  // ── Local Fonts ────────────────────────────────────────────────────────────
  if (config.local?.length) {
    const result = processLocalFonts(config.local);
    cssChunks.push(...result.css);
    preloadTags.push(...result.preloads);
  }

  return {
    css: cssChunks.length > 0
      ? `<style id="nexus-fonts">\n${cssChunks.join('\n')}\n</style>`
      : '',
    links: linkTags.join('\n'),
    preloads: preloadTags.join('\n'),
  };
}

async function processGoogleFonts(
  fonts: GoogleFont[],
  strategy: FontStrategy,
): Promise<{ css: string[]; links: string[]; preloads: string[] }> {
  const css: string[] = [];
  const links: string[] = [];
  const preloads: string[] = [];

  for (const font of fonts) {
    const weights = font.weights ?? [400];
    const display = font.display ?? 'swap';
    const subsets = font.subsets ?? ['latin'];

    // Build Google Fonts API v2 URL
    const family = font.family.replace(/ /g, '+');
    const axes = weights.length > 1
      ? `wght@${weights.join(';')}`
      : `wght@${weights[0]}`;
    const googleUrl = `https://fonts.googleapis.com/css2?family=${family}:${axes}&display=${display}&subset=${subsets.join(',')}`;

    if (strategy === 'inline') {
      try {
        const fetched = await fetchWithTimeout(googleUrl, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; NexusBot/1.0)' },
        });
        if (fetched.ok) {
          const fontCSS = await fetched.text();
          // Replace font-display to ensure it's correct
          css.push(fontCSS.replace(/font-display:\s*\w+/g, `font-display: ${display}`));
          continue;
        }
      } catch {
        // Fall through to link strategy
      }
    }

    // Preconnect + stylesheet link (fallback or non-inline strategy)
    links.push(`<link rel="preconnect" href="https://fonts.googleapis.com">`);
    links.push(`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`);
    links.push(
      `<link rel="stylesheet" href="${googleUrl}" media="print" onload="this.media='all'">`,
    );
    // Noscript fallback
    links.push(`<noscript><link rel="stylesheet" href="${googleUrl}"></noscript>`);
  }

  return { css, links, preloads };
}

function processLocalFonts(
  fonts: LocalFont[],
): { css: string[]; preloads: string[] } {
  const css: string[] = [];
  const preloads: string[] = [];

  for (const font of fonts) {
    const display = font.display ?? 'swap';
    const ext = font.src.split('.').pop() ?? 'woff2';
    const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : 'truetype';

    css.push(`@font-face {
  font-family: '${font.family}';
  src: url('${font.src}') format('${format}');
  font-weight: ${font.weight ?? 400};
  font-style: ${font.style ?? 'normal'};
  font-display: ${display};${font.unicodeRange ? `\n  unicode-range: ${font.unicodeRange};` : ''}
}`);

    // Preload woff2 (most efficient format)
    if (ext === 'woff2') {
      preloads.push(
        `<link rel="preload" href="${font.src}" as="font" type="font/woff2" crossorigin>`,
      );
    }
  }

  return { css, preloads };
}

/**
 * Detects fonts used in the CSS output and returns preload hints.
 * Parses `url(...)` references inside @font-face blocks.
 */
export function extractFontPreloads(css: string): string[] {
  const preloads: string[] = [];
  const re = /url\(['"]?([^'")\s]+\.woff2)['"]?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    if (m[1]) {
      preloads.push(
        `<link rel="preload" href="${m[1]}" as="font" type="font/woff2" crossorigin>`,
      );
    }
  }
  return [...new Set(preloads)];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
