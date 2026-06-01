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
/**
 * `.nx` pages often use `<template>...</template>` as the root. In the live DOM,
 * `<template>` contents are inert (not rendered). SSR must unwrap the outer
 * wrapper so the shell is visible; nested `<template>` inside the tree is rare
 * and still wrapped until unwrapped by the same pass on inner routes only when
 * they are the file root.
 */
export function unwrapOuterTemplateElement(html: string): string {
  const t = html.trimStart();
  if (!/^<template\b/i.test(t)) return html;

  const lower = t.toLowerCase();
  let depth = 0;
  let i = 0;
  let contentStart = -1;

  while (i < t.length) {
    const open = lower.indexOf('<template', i);
    const close = lower.indexOf('</template>', i);

    if (open !== -1 && (close === -1 || open < close)) {
      if (depth === 0) {
        const gt = t.indexOf('>', open);
        if (gt === -1) return html;
        contentStart = gt + 1;
      }
      depth++;
      i = open + '<template'.length;
      continue;
    }

    if (close !== -1) {
      depth--;
      if (depth === 0 && contentStart !== -1) {
        return t.slice(contentStart, close).trim();
      }
      i = close + '</template>'.length;
      continue;
    }

    break;
  }

  return html;
}

export function scopeTemplate(html: string, hash: string): string {
  const skip = new Set(['html', 'head', 'body', 'meta', 'link', 'script', 'style', 'nexus-island', 'slot']);
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const afterLt = html.slice(lt + 1);
    if (afterLt[0] === '/' || afterLt[0] === '!') {
      const gt = html.indexOf('>', lt);
      if (gt === -1) {
        out += html.slice(lt);
        break;
      }
      out += html.slice(lt, gt + 1);
      i = gt + 1;
      continue;
    }
    const tagM = /^([a-zA-Z][\w-]*)/.exec(afterLt);
    if (!tagM) {
      out += '<';
      i = lt + 1;
      continue;
    }
    const tag = tagM[1] ?? '';
    if (!tag) {
      out += '<';
      i = lt + 1;
      continue;
    }
    const lower = tag.toLowerCase();
    let j = lt + 1 + tagM[0].length;
    let brace = 0;
    let quote: string | null = null;
    let closed = false;
    while (j < html.length) {
      const c = html[j];
      if (quote !== null) {
        if (c === '\\' && j + 1 < html.length) {
          j += 2;
          continue;
        }
        if (c === quote) quote = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        j++;
        continue;
      }
      if (c === '{') brace++;
      else if (c === '}') brace = Math.max(0, brace - 1);
      else if (c === '/' && html[j + 1] === '>' && brace === 0) {
        const full = html.slice(lt, j + 2);
        if (skip.has(lower) || full.includes('data-nx=')) {
          out += full;
        } else {
          const attrPart = html.slice(lt + 1 + tagM[0].length, j);
          out += `<${tag}${attrPart} data-nx="${hash}" />`;
        }
        j += 2;
        closed = true;
        break;
      } else if (c === '>' && brace === 0) {
        const full = html.slice(lt, j + 1);
        if (skip.has(lower) || full.includes('data-nx=')) {
          out += full;
        } else {
          const attrPart = html.slice(lt + 1 + tagM[0].length, j);
          out += `<${tag}${attrPart} data-nx="${hash}">`;
        }
        j++;
        closed = true;
        break;
      }
      j++;
    }
    if (!closed) {
      out += html.slice(lt);
      break;
    }
    i = j;
  }
  return out;
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
      const semiEnd = block.indexOf(';', i);

      // At-rules that end with ; and have no block: @import, @charset, @namespace
      if (semiEnd !== -1 && (atEnd === -1 || semiEnd < atEnd)) {
        const atRule = block.slice(i, semiEnd + 1).trim();
        result.push(atRule);
        i = semiEnd + 1;
        continue;
      }

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
  const trimmed = sel.trim();

  // Global selectors that should never be scoped (:root targets <html> which
  // never receives data-nx; html/body/* are global by nature).
  if (/^:(root|host)$/.test(trimmed) || /^(html|body|\*)$/.test(trimmed)) {
    return trimmed;
  }

  // :global(...) escape hatch — strip :global() wrapper, don't scope
  if (/^:global\(/.test(trimmed)) {
    return trimmed.replace(/:global\(([^)]+)\)/g, '$1');
  }

  // Partial :global(...) inside selector — unwrap only the :global(...) parts
  // but keep the rest scoped.
  if (trimmed.includes(':global(')) {
    const unwrapped = trimmed.replace(/:global\(([^)]+)\)/g, '$1');
    // After unwrapping, if it's now a purely global selector, return as-is
    if (/^:(root|host)$/.test(unwrapped) || /^(html|body|\*)$/.test(unwrapped)) {
      return unwrapped;
    }
    return `${attr} ${unwrapped}, ${attr}${unwrapped}`;
  }

  // Skip already-scoped or bare combinators
  if (trimmed.startsWith(attr)) return trimmed;

  // Default: prepend the scope attribute as ancestor, AND as attribute on
  // the first compound selector.  scopeTemplate() injects data-nx directly
  // onto every root element, so we need both forms:
  //   [data-nx] .card   → matches when data-nx is on a parent
  //   [data-nx].card    → matches when data-nx is on the element itself
  return `${attr} ${trimmed}, ${attr}${trimmed}`;
}
