import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cwd } from 'node:process';

import { renderMarkdown } from './render.js';
import { parseFrontmatter } from './frontmatter.js';
import type { ContentEntry, LoadContentOptions } from './types.js';
import { escapeHtml } from './utils.js';

/**
 * Load a content file (Markdown) by relative path.
 *
 * Supports i18n fallback: if `locale` is provided, looks for:
 *   `{contentDir}/{path}.{locale}.md`
 *   → falls back to `{contentDir}/{path}.md`
 *
 * Example:
 *   loadContent('docs/getting-started', { locale: 'es' })
 *   → tries src/content/docs/getting-started.es.md
 *   → falls back to src/content/docs/getting-started.md
 */
export function loadContent(
  relativePath: string,
  opts: LoadContentOptions = {}
): ContentEntry {
  const {
    locale,
    defaultLocale = 'en',
    contentDir = 'src/content',
    includeRaw = false,
    extractHeadings = true,
    ...renderOpts
  } = opts;

  const baseDir = join(cwd(), contentDir);

  // Try localized version first, then default
  const candidates: string[] = [];
  if (locale && locale !== defaultLocale) {
    candidates.push(join(baseDir, `${relativePath}.${locale}.md`));
  }
  candidates.push(join(baseDir, `${relativePath}.md`));

  let raw: string | undefined;
  let filePath: string | undefined;
  let resolvedLocale = locale || defaultLocale;

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      raw = readFileSync(candidate, 'utf-8');
      filePath = candidate;
      break;
    }
  }

  if (raw === undefined) {
    // Return a minimal entry with a fallback message
    return {
      raw: '',
      html: `<p>Content not found for <code>${escapeHtml(relativePath)}</code>.</p>`,
      meta: {},
      headings: [],
      locale: resolvedLocale,
      filePath: candidates[0]!,
    };
  }

  const { meta, body } = parseFrontmatter(raw);

  // If this was a localized file, confirm the resolved locale
  if (filePath && locale && locale !== defaultLocale) {
    const localeMatch = filePath.match(/\.([a-z]{2})\.md$/);
    if (localeMatch) {
      resolvedLocale = localeMatch[1]!;
    }
  }

  const { html, headings } = renderMarkdown(body, {
    ...renderOpts,
    extractHeadings,
  });

  return {
    raw: includeRaw ? raw : '',
    html,
    meta,
    headings,
    locale: resolvedLocale,
    filePath: filePath!,
  };
}
