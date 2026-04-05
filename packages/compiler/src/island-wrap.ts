/**
 * Wraps every element that uses a client:* hydration directive in <nexus-island>,
 * so the Node dev server can serve a real ESM bundle at /_nexus/islands/client.mjs.
 * Multiple islands per page share one client module; each wrapper gets data-nexus-island-index.
 */

import { relative } from 'node:path';

const CLIENT_DIR_RE = /\sclient:(load|idle|visible|media)(?:=["']([^"']*)["'])?/;

/**
 * Opening tag that contains client:(load|idle|visible|media).
 * `(?:[^>]*\\s)?` allows `client:load` as the first attribute (`<Foo client:load>`), not only
 * after another attribute (`<Foo class="x" client:load>`).
 */
/** Optional `/` before `>` so `<Foo client:load />` matches (void-style components). */
const OPEN_WITH_CLIENT_RE =
  /<([a-zA-Z][\w-]*)(\s(?:[^>]*\s)?client:(?:load|idle|visible|media)(?:=["'][^"']*["'])?[^>]*)\s*\/?>/;

function extractBalanced(
  html: string,
  openEnd: number,
  tag: string,
): { inner: string; closeEnd: number } | null {
  const reOpen = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
  const reClose = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    reOpen.lastIndex = i;
    reClose.lastIndex = i;
    const mo = reOpen.exec(html);
    const mc = reClose.exec(html);
    const iOpen = mo?.index ?? Number.POSITIVE_INFINITY;
    const iClose = mc?.index ?? Number.POSITIVE_INFINITY;
    if (iClose === Number.POSITIVE_INFINITY) return null;
    if (mo && iOpen < iClose) {
      depth++;
      i = iOpen + mo[0].length;
    } else if (mc) {
      depth--;
      if (depth === 0) {
        return { inner: html.slice(openEnd, iClose), closeEnd: iClose + mc[0].length };
      }
      i = iClose + mc[0].length;
    } else {
      return null;
    }
  }
  return null;
}

function stripClientDirective(attrs: string): string {
  return attrs.replace(CLIENT_DIR_RE, ' ').replace(/\s+/g, ' ').trim();
}

function islandQueryParam(absFilePath: string, appRoot?: string): string {
  if (appRoot && absFilePath.startsWith(appRoot)) {
    const rel = relative(appRoot, absFilePath).replace(/\\/g, '/');
    return `path=${encodeURIComponent(rel)}`;
  }
  return `abs=${encodeURIComponent(absFilePath)}`;
}

export interface IslandWrapResult {
  template: string;
  /** First island inner root (backward compat for single-island callers) */
  clientTemplate: string | null;
  /** One HTML fragment per island (same order as data-nexus-island-index) */
  clientFragments: string[];
  didWrap: boolean;
}

/**
 * Finds every tag with a `client:*` directive and wraps each (balanced subtree)
 * in <nexus-island> pointing at /_nexus/islands/client.mjs.
 */
export function wrapSelfClientIslandMarkers(
  template: string,
  absFilePath: string,
  appRoot?: string,
): IslandWrapResult {
  let t = template;
  const fragments: string[] = [];
  const idBase = absFilePath.replace(/[^a-zA-Z0-9]/g, '_');
  const q = islandQueryParam(absFilePath, appRoot);
  const islandUrl = `/_nexus/islands/client.mjs?${q}`;

  while (true) {
    OPEN_WITH_CLIENT_RE.lastIndex = 0;
    const m = OPEN_WITH_CLIENT_RE.exec(t);
    if (!m) {
      break;
    }

    const tag = m[1] ?? 'div';
    const fullAttrs = m[2] ?? '';
    const openMatchStart = m.index ?? 0;
    const openTagEnd = openMatchStart + m[0].length;

    const strat = fullAttrs.match(CLIENT_DIR_RE);
    const strategy = (strat?.[1] ?? 'load') as 'load' | 'idle' | 'visible' | 'media';
    const mediaQuery = strat?.[2];

    /** `[^>]*` can capture a trailing `/` before `>` on void-style tags — drop it for valid `<Tag></Tag>`. */
    const cleanAttrs = stripClientDirective(fullAttrs)
      .replace(/\s*\/\s*$/u, '')
      .trim();
    const innerRootOpen = `<${tag}${cleanAttrs ? ' ' + cleanAttrs : ''}>`;
    const innerRootClose = `</${tag}>`;

    let inner: string;
    let closeEnd: number;
    if (m[0].trimEnd().endsWith('/>')) {
      inner = '';
      closeEnd = openTagEnd;
    } else {
      const balanced = extractBalanced(t, openTagEnd, tag);
      if (!balanced) {
        break;
      }
      inner = balanced.inner;
      closeEnd = balanced.closeEnd;
    }

    const clientTemplate = innerRootOpen + inner + innerRootClose;
    fragments.push(clientTemplate);

    const islandIdx = fragments.length - 1;
    const islandId = `island_${idBase}_${islandIdx}`.toLowerCase();
    const dataStrategy =
      strategy === 'media' && mediaQuery
        ? `data-nexus-strategy="client:media" data-nexus-media="${escapeAttr(mediaQuery)}"`
        : `data-nexus-strategy="client:${strategy}"`;

    const wrapped =
      t.slice(0, openMatchStart) +
      `<nexus-island
    data-nexus-island="${islandId}"
    data-nexus-island-index="${islandIdx}"
    data-nexus-component="${islandUrl}"
    ${dataStrategy}
  >${clientTemplate}</nexus-island>` +
      t.slice(closeEnd);

    t = wrapped;
  }

  return {
    template: t,
    clientTemplate: fragments[0] ?? null,
    clientFragments: fragments,
    didWrap: fragments.length > 0,
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
