// Code highlighting integration — shiki as optional peer dependency.
// Falls back silently if shiki is not installed.

import type { HlOptions } from './types.js';
import { escapeHtml, escapeAttr } from './utils.js';

type ShikiHighlighter = {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => Promise<string>;
};

let shikiInstance: ShikiHighlighter | null = null;
let shikiPromise: Promise<ShikiHighlighter | null> | null = null;

async function getShiki(): Promise<typeof shikiInstance> {
  if (shikiInstance) return shikiInstance;
  if (shikiPromise) return shikiPromise;

  shikiPromise = import('shiki')
    .then(async (mod) => {
      const shiki = typeof mod.createHighlighter === 'function'
        ? await (mod.createHighlighter as any)({ themes: ['dark-plus', 'light-plus'], langs: [] })
        : (mod as any);
      shikiInstance = shiki;
      return shikiInstance;
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
  const shiki = await getShiki();
  if (!shiki) {
    // Fallback: no syntax highlighting
    return `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`;
  }

  try {
    const html = await shiki.codeToHtml(code, {
      lang: lang || 'text',
      theme: opts.theme || 'dark-plus',
    });
    return html;
  } catch {
    // Language not supported or other shiki error
    return `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`;
  }
}
