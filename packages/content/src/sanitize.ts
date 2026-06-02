import type { RenderOptions } from './types.js';
import { escapeAttr } from './utils.js';

const DEFAULT_ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'pre', 'code', 'blockquote',
  'a', 'img', 'br', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'ul', 'ol', 'li',
  'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'del', 's', 'ins',
  'sub', 'sup',
  'div', 'span',
  'details', 'summary',
  'style',
]);

const DEFAULT_ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'class']),
  img: new Set(['src', 'alt', 'title', 'class', 'loading', 'width', 'height']),
  code: new Set(['class']),
  pre: new Set(['class']),
  p: new Set(['class']),
  h1: new Set(['id', 'class']),
  h2: new Set(['id', 'class']),
  h3: new Set(['id', 'class']),
  h4: new Set(['id', 'class']),
  h5: new Set(['id', 'class']),
  h6: new Set(['id', 'class']),
  li: new Set(['class']),
  ul: new Set(['class']),
  ol: new Set(['class', 'start']),
  table: new Set(['class']),
  td: new Set(['class', 'colspan', 'rowspan']),
  th: new Set(['class', 'colspan', 'rowspan']),
  div: new Set(['class']),
  span: new Set(['class']),
  blockquote: new Set(['class']),
};

const EVENT_HANDLER_PATTERN = /^on/i;
const JAVASCRIPT_PROTOCOL = /^javascript:/i;
const DATA_PROTOCOL = /^data:/i;

/**
 * Sanitize HTML by stripping scripts, event handlers, and optionally
 * whitelisting tags/attributes.
 *
 * Security note: this is designed for "semi-trusted" content — your own Markdown
 * files, not arbitrary user input. For raw user HTML, use a dedicated sanitizer.
 */
export function sanitizeHTML(
  html: string,
  opts: RenderOptions = {}
): string {
  const {
    stripScripts = true,
    allowedTags,
    allowedAttributes,
    cspNonce,
    baseUrl,
    sanitize = 'strict',
  } = opts;

  let result = html;

  // 1. Strip <script> tags (block and self-closing)
  if (stripScripts) {
    result = result
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/>/gi, '');
  }

  // 2. Strip event handler attributes (onclick, onerror, etc.)
  result = result.replace(/\s+on\w+="[^"]*"/gi, '');
  result = result.replace(/\s+on\w+='[^']*'/gi, '');

  // 3. If strict mode, whitelist tags and attributes
  if (sanitize === 'strict') {
    const tagSet = allowedTags
      ? new Set(allowedTags.map(t => t.toLowerCase()))
      : DEFAULT_ALLOWED_TAGS;

    const attrMap = allowedAttributes
      ? Object.fromEntries(
          Object.entries(allowedAttributes).map(([k, v]) => [
            k.toLowerCase(),
            new Set(v.map(a => a.toLowerCase())),
          ])
        )
      : DEFAULT_ALLOWED_ATTRIBUTES;

    // Parse and filter HTML — lightweight regex-based approach for small content
    // For complex HTML this is a limit; document that limitation
    result = filterHTML(result, tagSet, attrMap, cspNonce, baseUrl);
  }

  return result.trim();
}

function filterHTML(
  html: string,
  allowedTags: Set<string>,
  attrMap: Record<string, Set<string>>,
  cspNonce?: string,
  baseUrl?: string
): string {
  // Simple approach: walk tags, validate, rewrite
  const tagPattern = /<(\/?)([\w-]+)((?:\s+[\w-:]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]*))?)*)\s*\/?>/gi;

  return html.replace(tagPattern, (match, slash, tagName, attrsStr) => {
    const tag = tagName.toLowerCase();

    // Not allowed? strip the entire tag but keep children text
    if (!allowedTags.has(tag)) {
      return slash === '/' ? '' : '';
    }

    // Parse and filter attributes
    const filteredAttrs = filterAttributes(tag, attrsStr, attrMap, cspNonce, baseUrl);

    const isSelfClosing = match.endsWith('/>');
    const selfClose = isSelfClosing ? ' /' : '';

    return `<${slash}${tag}${filteredAttrs}${selfClose}>`;
  });
}

function filterAttributes(
  tag: string,
  attrsStr: string,
  attrMap: Record<string, Set<string>>,
  cspNonce?: string,
  baseUrl?: string
): string {
  const parts: string[] = [];
  const allowed = attrMap[tag] || new Set<string>();

  // Parse attributes with regex
  const attrPattern = /([\w-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/gi;

  while (true) {
    const matchArr = attrPattern.exec(attrsStr);
    if (!matchArr) break;
    const capturedName = matchArr[1];
    if (capturedName === undefined) continue;
    const name = capturedName.toLowerCase();
    const value = matchArr[2] ?? matchArr[3] ?? matchArr[4] ?? '';

    // Skip event handlers
    if (EVENT_HANDLER_PATTERN.test(name)) continue;

    // Skip javascript: URLs in href/src
    if ((name === 'href' || name === 'src') && JAVASCRIPT_PROTOCOL.test(value)) continue;

    // Skip data: URLs in src (XSS vector)
    if (name === 'src' && DATA_PROTOCOL.test(value)) continue;

    if (allowed.has(name) || allowed.has('*')) {
      // Resolve relative URLs against baseUrl
      let resolvedValue = value;
      if (baseUrl && (name === 'href' || name === 'src') && !value.startsWith('http') && !value.startsWith('//') && !value.startsWith('#')) {
        try {
          resolvedValue = new URL(value, baseUrl).href;
        } catch { /* keep original */ }
      }
      parts.push(`${name}="${escapeAttr(resolvedValue)}"`);
    }
  }

  // Inject CSP nonce into <style> tags
  if (cspNonce && tag === 'style') {
    parts.push(`nonce="${escapeAttr(cspNonce)}"`);
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}
