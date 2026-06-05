// Code highlighting integration — shiki as optional peer dependency.
// Falls back silently if shiki is not installed.

import type { HlOptions } from './types.js';
import { escapeHtml, escapeAttr } from './utils.js';

type ShikiModule = {
  // Shiki v1+ top-level codeToHtml returns string directly (sync after internal load)
  codeToHtml?: (code: string, opts: { lang: string; theme: string }) => string | Promise<string>;
  // Legacy createHighlighter path returns Highlighter whose codeToHtml is async
  createHighlighter?: (opts: { themes: string[]; langs: string[] }) => Promise<{
    codeToHtml: (code: string, opts: { lang: string; theme: string }) => Promise<string>;
  }>;
};

let shikiMod: ShikiModule | null = null;
let shikiPromise: Promise<ShikiModule | null> | null = null;

async function getShiki(): Promise<ShikiModule | null> {
  if (shikiMod) return shikiMod;
  if (shikiPromise) return shikiPromise;

  shikiPromise = import('shiki')
    .then((mod) => {
      // Cast via unknown to accommodate shiki's full module shape vs our narrow view
      shikiMod = mod as unknown as ShikiModule;
      return shikiMod;
    })
    .catch(() => {
      // shiki not installed or failed to load — graceful fallback
      return null;
    });

  return shikiPromise;
}

/**
 * Highlight code block using shiki (if available).
 * Returns raw HTML string (already escaped).
 * Falls back to plain <pre><code> if shiki is not installed.
 */
export async function highlightCode(
  code: string,
  lang: string,
  opts: HlOptions = {}
): Promise<string> {
  const mod = await getShiki();
  if (!mod) {
    // Fallback: no syntax highlighting
    return `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`;
  }

  try {
    // Shiki v1+: codeToHtml top-level loads languages lazily — preferred (returns string | Promise)
    if (typeof mod.codeToHtml === 'function') {
      const maybePromise = mod.codeToHtml(code, {
        lang: lang || 'text',
        theme: opts.theme || 'dark-plus',
      });
      const html = await Promise.resolve(maybePromise);
      return html;
    }

    // Legacy: createHighlighter API (requires pre-loading langs)
    if (typeof mod.createHighlighter === 'function') {
      const highlighter = await mod.createHighlighter({
        themes: [opts.theme || 'dark-plus'],
        langs: [lang || 'text'],
      });
      const html = await highlighter.codeToHtml(code, {
        lang: lang || 'text',
        theme: opts.theme || 'dark-plus',
      });
      return html;
    }

    return `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`;
  } catch {
    // Language not supported or other shiki error
    return `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`;
  }
}
