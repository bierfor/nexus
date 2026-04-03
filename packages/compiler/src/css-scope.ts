/**
 * Nexus CSS Scoping — Compile-time class hash injection with @layer.
 *
 * Strategy: Pure AOT, zero runtime overhead.
 *
 * Specificity fix (the insight from the user):
 *   Plain [data-nx="hash"] .card has higher specificity than .card,
 *   which breaks overrides from parent components or third-party libraries.
 *
 *   Solution: Wrap ALL generated scoped styles inside @layer nexus.scoped.
 *   CSS Cascade Layers (Level 5 spec, baseline 2022) have LOWER specificity
 *   than unlayered styles by design, regardless of selector weight.
 *
 *   Layer precedence (highest wins, last wins within same layer):
 *     unlayered styles  >  @layer nexus.global  >  @layer nexus.scoped
 *
 *   This means:
 *     - Component styles (.card) are isolated by hash ✓
 *     - Parent overrides work without !important ✓
 *     - Third-party libraries can override without !important ✓
 *     - :global(selector) still works as an escape hatch ✓
 *
 * How it works:
 *   1. Compute a stable 6-char hash from the component filepath (FNV-1a).
 *   2. Rewrite every CSS selector to be scoped with [data-nx="<hash>"].
 *   3. Wrap the entire output in @layer nexus.scoped { ... }.
 *   4. Inject data-nx="<hash>" onto every root element in the template.
 *
 * Example — input:
 *   .card { color: red }
 *   .card:hover h2 { font-size: 2rem }
 *   @media (max-width: 768px) { .card { display: none } }
 *
 * Output:
 *   @layer nexus.scoped {
 *     [data-nx="a3f9c1"] .card { color: red }
 *     [data-nx="a3f9c1"] .card:hover h2 { font-size: 2rem }
 *     @media (max-width: 768px) { [data-nx="a3f9c1"] .card { display: none } }
 *   }
 *
 * Template rewrite:
 *   <div class="card">  →  <div class="card" data-nx="a3f9c1">
 *
 * Layer declaration (injected once in root layout):
 *   @layer nexus.scoped, nexus.global;
 */

/** Murmurhash-inspired: fast, stable 32-bit hash → 6 hex chars */
export function componentHash(filepath: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < filepath.length; i++) {
    h ^= filepath.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

export interface ScopedCSS {
  css: string;
  hash: string;
  /** Class names defined in this scope */
  classes: Set<string>;
}

/**
 * Transforms raw CSS into scoped CSS using the component hash.
 * Handles: selectors, @media, @keyframes (not scoped), @layer, :global() escape hatch.
 */
/** Layer declaration to emit once in the root <head> */
export const NEXUS_LAYER_DECLARATION = '@layer nexus.scoped, nexus.global;';

export function scopeCSS(rawCSS: string, filepath: string): ScopedCSS {
  const hash = componentHash(filepath);
  const attr = `[data-nx="${hash}"]`;
  const classes = new Set<string>();

  // Extract class names for template injection tracking
  const classRe = /\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(rawCSS)) !== null) {
    if (m[1]) classes.add(m[1]);
  }

  const scoped = transformCSS(rawCSS, attr);

  // Wrap in @layer nexus.scoped — fixes specificity wars.
  // Cascade layers have lower priority than unlayered styles, so parent
  // components and global CSS can always override without !important.
  const layered = `@layer nexus.scoped {\n${scoped}\n}`;

  return { css: layered, hash, classes };
}

/**
 * Adds scope attribute to every HTML root element in a template string.
 * Skips elements that are: slot, nexus-island, html, head, body.
 * Handles :global(selector) — removes scoping for that selector.
 */
export function scopeTemplate(html: string, hash: string): string {
  // Inject data-nx on all opening HTML tags (not self-closing meta/link/etc)
  return html.replace(
    /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g,
    (full, tag: string, attrs: string = '') => {
      const skip = new Set(['html', 'head', 'body', 'meta', 'link', 'script', 'style', 'nexus-island', 'slot']);
      if (skip.has(tag.toLowerCase())) return full;
      if (attrs.includes('data-nx=')) return full; // already scoped
      return `<${tag}${attrs} data-nx="${hash}">`;
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal CSS transformer
// ─────────────────────────────────────────────────────────────────────────────

function transformCSS(css: string, attr: string): string {
  // Remove /* comments */
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Tokenize into rules (naive but effective for our subset)
  return processBlock(stripped, attr);
}

function processBlock(block: string, attr: string): string {
  const result: string[] = [];
  let i = 0;
  const len = block.length;

  while (i < len) {
    // Skip whitespace
    const wsStart = i;
    while (i < len && /\s/.test(block[i] ?? '')) i++;

    // @ rules
    if (block[i] === '@') {
      const atEnd = block.indexOf('{', i);
      if (atEnd === -1) { i = len; continue; }

      const atRule = block.slice(i, atEnd).trim();
      i = atEnd + 1;

      // Find matching closing brace
      let depth = 1;
      const bodyStart = i;
      while (i < len && depth > 0) {
        if (block[i] === '{') depth++;
        else if (block[i] === '}') depth--;
        i++;
      }
      const body = block.slice(bodyStart, i - 1);

      // @keyframes — don't scope
      if (/^@keyframes/i.test(atRule)) {
        result.push(`${atRule} {${body}}`);
      }
      // @layer, @supports, @media — recurse into body
      else if (/^@(media|supports|layer|container)/i.test(atRule)) {
        result.push(`${atRule} {${processBlock(body, attr)}}`);
      }
      // Other @ rules — pass through
      else {
        result.push(`${atRule} {${body}}`);
      }
      continue;
    }

    // Regular rule: find selector + body
    const ruleStart = i;
    const braceOpen = block.indexOf('{', i);
    if (braceOpen === -1) break;

    const selector = block.slice(i, braceOpen).trim();
    i = braceOpen + 1;

    let depth = 1;
    const bodyStart = i;
    while (i < len && depth > 0) {
      if (block[i] === '{') depth++;
      else if (block[i] === '}') depth--;
      i++;
    }
    const body = block.slice(bodyStart, i - 1);

    if (!selector) continue;

    const scopedSelector = scopeSelector(selector, attr);
    result.push(`${scopedSelector} {${body}}`);
  }

  return result.join('\n');
}

/**
 * Scopes a CSS selector string (may be comma-separated).
 * Handles :global(selector) escape hatch — removes scope for that part.
 */
function scopeSelector(selector: string, attr: string): string {
  return selector
    .split(',')
    .map((s) => scopeSingleSelector(s.trim(), attr))
    .join(', ');
}

function scopeSingleSelector(sel: string, attr: string): string {
  // :global(...) escape hatch — strip :global() wrapper, don't scope
  if (/^:global\(/.test(sel)) {
    return sel.replace(/:global\(([^)]+)\)/g, '$1');
  }

  // Handle :global inside a selector
  if (sel.includes(':global(')) {
    return sel.replace(/:global\(([^)]+)\)/g, '$1');
  }

  // Skip already-scoped or bare combinators
  if (sel.startsWith(attr)) return sel;

  // For :root, :host — insert attr before
  if (/^:(root|host)/.test(sel)) {
    return `${attr}${sel}`;
  }

  // Default: prepend the scope attribute
  return `${attr} ${sel}`;
}
