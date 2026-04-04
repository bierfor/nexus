/**
 * Wraps the first element that uses a client:* hydration directive in <nexus-island>,
 * so the Node dev server can serve a real ESM bundle at /_nexus/islands/client.mjs.
 */

import { relative } from 'node:path';

const CLIENT_DIR_RE = /\sclient:(load|idle|visible|media)(?:=["']([^"']*)["'])?/;

/** Opening tag that contains client:(load|idle|visible|media). */
const OPEN_WITH_CLIENT_RE =
  /<([a-zA-Z][\w-]*)(\s[^>]*\sclient:(?:load|idle|visible|media)(?:=["'][^"']*["'])?[^>]*)\s*>/;

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
  /** Inner HTML (single island root) for the client bundle metadata; null if no wrap. */
  clientTemplate: string | null;
  didWrap: boolean;
}

/**
 * Finds the first tag with a `client:*` directive and wraps it (and its balanced children)
 * in <nexus-island> pointing at /_nexus/islands/client.mjs.
 */
export function wrapSelfClientIslandMarkers(
  template: string,
  absFilePath: string,
  appRoot?: string,
): IslandWrapResult {
  const m = OPEN_WITH_CLIENT_RE.exec(template);
  if (!m) {
    return { template, clientTemplate: null, didWrap: false };
  }

  const tag = m[1] ?? 'div';
  const fullAttrs = m[2] ?? '';
  const openMatchStart = m.index ?? 0;
  const openTagEnd = openMatchStart + m[0].length;

  const strat = fullAttrs.match(CLIENT_DIR_RE);
  const strategy = (strat?.[1] ?? 'load') as 'load' | 'idle' | 'visible' | 'media';
  const mediaQuery = strat?.[2];

  const cleanAttrs = stripClientDirective(fullAttrs);
  const balanced = extractBalanced(template, openTagEnd, tag);
  if (!balanced) {
    return { template, clientTemplate: null, didWrap: false };
  }

  const idBase = absFilePath.replace(/[^a-zA-Z0-9]/g, '_');
  const islandId = `island_${idBase}_root`.toLowerCase();
  const q = islandQueryParam(absFilePath, appRoot);
  const islandUrl = `/_nexus/islands/client.mjs?${q}`;
  const dataStrategy =
    strategy === 'media' && mediaQuery
      ? `data-nexus-strategy="client:media" data-nexus-media="${escapeAttr(mediaQuery)}"`
      : `data-nexus-strategy="client:${strategy}"`;

  const innerRootOpen = `<${tag}${cleanAttrs ? ' ' + cleanAttrs : ''}>`;
  const innerRootClose = `</${tag}>`;
  const clientTemplate = innerRootOpen + balanced.inner + innerRootClose;

  const wrapped =
    template.slice(0, openMatchStart) +
    `<nexus-island
    data-nexus-island="${islandId}"
    data-nexus-component="${islandUrl}"
    ${dataStrategy}
  >${clientTemplate}</nexus-island>` +
    template.slice(balanced.closeEnd);

  return { template: wrapped, clientTemplate, didWrap: true };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
