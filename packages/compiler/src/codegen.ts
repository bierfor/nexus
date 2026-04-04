import type {
  ParsedComponent,
  CompileOptions,
  CompileResult,
  CompileWarning,
  IslandManifest,
  IslandEntry,
  ServerAction,
} from './types.js';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scopeCSS, scopeTemplate, unwrapOuterTemplateElement } from './css-scope.js';
import { wrapSelfClientIslandMarkers, type IslandWrapResult } from './island-wrap.js';
import {
  islandSsrStubLines,
  listRuneBindingNames,
  extractDollarStateInitializers,
} from './island-ssr-stubs.js';
import { transformPretextExport } from './pretext-extract.js';

/** Generates a unique stable island ID from filepath + component name */
function islandId(filepath: string, componentName: string): string {
  const base = filepath.replace(/[^a-zA-Z0-9]/g, '_');
  return `island_${base}_${componentName}`.toLowerCase();
}

const LIB_IMPORT_EXT_ORDER = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'] as const;

/** Resolve `$lib/…` to an on-disk path so Node ESM can load it (extension required). */
function resolveDollarLibFilePath(appRoot: string, rel: string): string {
  const root = normalize(appRoot);
  const abs = join(root, 'src/lib', rel);
  if (existsSync(abs)) return abs;
  const hasKnownExt = /\.(ts|tsx|mts|js|mjs|cjs)$/u.test(rel);
  if (hasKnownExt) return abs;
  for (const ext of LIB_IMPORT_EXT_ORDER) {
    const candidate = abs + ext;
    if (existsSync(candidate)) return candidate;
  }
  return abs + '.ts';
}

/** Resolve `$lib/…` in server frontmatter to absolute file URLs for Node ESM. */
function rewriteDollarLibImports(code: string, opts: CompileOptions): string {
  const appRoot = opts.appRoot;
  if (!appRoot) return code;
  const root = normalize(appRoot);
  const libBust =
    opts.dev &&
    typeof opts.libDepsMtime === 'number' &&
    Number.isFinite(opts.libDepsMtime) &&
    opts.libDepsMtime > 0
      ? `?t=${Math.floor(opts.libDepsMtime)}`
      : '';
  return code.replace(/from\s*['"]\$lib\/([^'"]+)['"]/gu, (_, rel: string) => {
    const abs = resolveDollarLibFilePath(root, rel);
    const href = pathToFileURL(abs).href + libBust;
    return `from ${JSON.stringify(href)}`;
  });
}

/** Compiles a parsed .nx component into server + client output */
export function generate(
  parsed: ParsedComponent,
  opts: CompileOptions,
): CompileResult {
  const warnings: CompileWarning[] = [];

  // ── CSS (AOT hash scoping — zero runtime) ─────────────────────────────────
  // Computed first so it can be passed into generateServerModule
  let css: string | null = null;
  let processedTemplate = parsed.template?.content ?? '';
  if (parsed.style) {
    const scoped = scopeCSS(parsed.style.content, parsed.filepath);
    css = scoped.css;
    // Inject data-nx hash onto template root elements
    processedTemplate = scopeTemplate(processedTemplate, scoped.hash);
  }

  // <template> roots are inert in the browser — unwrap for visible SSR HTML
  processedTemplate = unwrapOuterTemplateElement(processedTemplate);

  const islandWrap = wrapSelfClientIslandMarkers(processedTemplate, parsed.filepath, opts.appRoot);
  processedTemplate = islandWrap.template;

  // ── Server module ──────────────────────────────────────────────────────────
  const serverCode = generateServerModule(parsed, opts, processedTemplate, islandWrap);

  // ── Client island code (only if there are reactive islands) ───────────────
  const needsClientIsland =
    islandWrap.didWrap ||
    parsed.islandDirectives.length > 0 ||
    (parsed.script?.content ?? '').includes('$state');
  const clientCode = needsClientIsland ? generateClientIsland(parsed, opts, islandWrap) : null;

  // ── Island manifest ────────────────────────────────────────────────────────
  const islandManifest: IslandManifest | null =
    opts.emitIslandManifest && parsed.islandDirectives.length > 0
      ? {
          islands: parsed.islandDirectives.map((d): IslandEntry => {
            const entry: IslandEntry = {
              id: islandId(parsed.filepath, d.componentName),
              componentPath: parsed.filepath,
              directive: d.directive,
              props: [],
            };
            if (d.mediaQuery !== undefined) {
              entry.mediaQuery = d.mediaQuery;
            }
            return entry;
          }),
        }
      : null;

  // ── Server Actions module ──────────────────────────────────────────────────
  const actionsModule =
    parsed.serverActions.length > 0
      ? generateActionsModule(parsed.serverActions, parsed.filepath)
      : null;

  return {
    serverCode,
    clientCode,
    css,
    islandManifest,
    actionsModule,
    map: null,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server module: runs on every request
// ─────────────────────────────────────────────────────────────────────────────
function generateServerModule(
  parsed: ParsedComponent,
  opts: CompileOptions,
  processedTemplate: string,
  islandWrap: IslandWrapResult,
): string {
  const lines: string[] = [];

  lines.push(`// [Nexus] Server module — generated from ${parsed.filepath}`);
  lines.push(`// DO NOT EDIT — this file is auto-generated`);
  lines.push('');

  if (parsed.pretext) {
    lines.push('// ── Pretext — merged into ctx.pretext (parallel across layout + page before render) ──');
    lines.push(rewriteDollarLibImports(transformPretextExport(parsed.pretext), opts));
    lines.push('');
  }

  // Frontmatter imports + data fetching (after pretext split: leading + // nexus:server)
  if (parsed.frontmatter) {
    lines.push('// ── Server-only data fetching (runs per request) ──');
    lines.push(rewriteDollarLibImports(parsed.frontmatter.content.trim(), opts));
    lines.push('');
  }

  // Runes from the client script — SSR must define matching locals whenever the template interpolates them.
  const runes = extractRuneDeclarations(parsed.script?.content ?? '');

  // Build render function
  lines.push('export async function render(ctx) {');
  lines.push('  const __html = await renderTemplate(ctx);');
  lines.push('  return {');
  lines.push('    html: __html,');
  lines.push(`    css: ${parsed.style ? 'true' : 'false'},`);
  lines.push(`    hasIslands: ${islandWrap.didWrap || parsed.islandDirectives.length > 0},`);
  lines.push('  };');
  lines.push('}');
  lines.push('');

  // Template renderer (simple expression interpolation → SSR)
  lines.push('async function renderTemplate(ctx) {');
  lines.push('  // Primary context from nxPretext (layouts + page, parallel merge) — mirrors client $pretext()');
  lines.push('  const pretext = ctx.pretext ?? {};');
  lines.push('  const $pretext = () => (ctx.pretext ?? {});');
  lines.push('  // Server-side template rendering (CSS-scoped at compile time)');
  // Island-wrapped pages may reference only plain functions (e.g. onsubmit={preventSubmit}) with no $state.
  if (parsed.script?.content && (runes.length > 0 || islandWrap.didWrap)) {
    for (const stub of islandSsrStubLines(parsed.script.content)) {
      lines.push(stub);
    }
  }
  lines.push(
    "  const __ssrAttr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;');",
  );
  lines.push(`  return \`${templateToSSR(processedTemplate)}\`;`);
  lines.push('}');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Client island: sent to browser only for interactive components
// ─────────────────────────────────────────────────────────────────────────────
function generateClientIsland(parsed: ParsedComponent, _opts: CompileOptions, islandWrap: IslandWrapResult): string {
  const lines: string[] = [];

  lines.push(`// [Nexus] Client Island — ${parsed.filepath}`);
  lines.push(`// Hydration strategy: ${parsed.islandDirectives.map((d) => d.directive).join(', ') || 'client:load'}`);
  lines.push('');
  lines.push("import { createIsland, $state, $derived, $effect, $pretext } from '/_nexus/rt/island.js';");
  lines.push('');

  const fragments =
    islandWrap.clientFragments.length > 0
      ? islandWrap.clientFragments
      : [islandWrap.clientTemplate ?? parsed.template?.content ?? ''];

  const scriptSrc = parsed.script?.content ?? '';
  const bindingNames = new Set(listRuneBindingNames(scriptSrc));
  const stateOnlyNames = new Set(extractDollarStateInitializers(scriptSrc).keys());

  const processedFragments: string[] = [];
  const exprFnBlocks: string[][] = [];
  for (const frag of fragments) {
    const { processed, exprLines } = processTemplateForClientIsland(frag, bindingNames);
    processedFragments.push(processed);
    exprFnBlocks.push(exprLines);
  }

  lines.push('const __nxIslandProcessed = [');
  for (const p of processedFragments) {
    lines.push(`  ${JSON.stringify(p)},`);
  }
  lines.push('];');
  lines.push('');

  lines.push('const __nxIslandFns = [');
  for (const block of exprFnBlocks) {
    lines.push('  [');
    for (const line of block) {
      lines.push(`    ${line},`);
    }
    lines.push('  ],');
  }
  lines.push('];');
  lines.push('');

  const delegated: Array<{ delegatedClickSelector: string; onDelegatedClick: string } | null> =
    fragments.map((frag) => extractDelegatedClickFromFragment(frag, stateOnlyNames));

  // Script content — Nexus runes use .value; $derived needs () => fn
  if (parsed.script) {
    lines.push('// ── Reactive State (Runes) ──');
    lines.push(transformRunesForClientRuntime(scriptSrc));
    lines.push('');
  }

  lines.push('const __nxDelegated = [');
  for (const d of delegated) {
    lines.push(
      d
        ? `  { delegatedClickSelector: ${JSON.stringify(d.delegatedClickSelector)}, onDelegatedClick: ${d.onDelegatedClick} },`
        : '  null,',
    );
  }
  lines.push('];');
  lines.push('');

  lines.push('export function mount(el, props = {}) {');
  lines.push(`  const idx = Number(el.getAttribute('data-nexus-island-index') ?? '0');`);
  lines.push('  const processedTemplate = __nxIslandProcessed[idx] ?? __nxIslandProcessed[0];');
  lines.push('  const exprFns = __nxIslandFns[idx] ?? __nxIslandFns[0];');
  lines.push('  return createIsland(el, {');
  lines.push('    processedTemplate,');
  lines.push('    exprFns,');
  lines.push('    ...(__nxDelegated[idx] ?? {}),');
  lines.push('    ...props,');
  lines.push('  });');
  lines.push('}');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Actions module: type-safe RPC stubs
// ─────────────────────────────────────────────────────────────────────────────
function generateActionsModule(actions: ServerAction[], filepath: string): string {
  const lines: string[] = [];

  lines.push(`// [Nexus] Server Actions — generated from ${filepath}`);
  lines.push(`"use server";`);
  lines.push('');
  const needsCreateAction = actions.some((a) => a.createActionSource);
  lines.push(
    needsCreateAction
      ? "import { createAction, registerAction } from '@nexus_js/server/actions';"
      : "import { registerAction } from '@nexus_js/server/actions';",
  );
  lines.push('');

  for (const action of actions) {
    lines.push(`/** @nexus-action "${action.name}" */`);
    if (action.createActionSource) {
      lines.push(
        `registerAction(${JSON.stringify(action.name)}, ${action.createActionSource}, { csrf: false });`,
      );
    } else {
      lines.push(
        `registerAction(${JSON.stringify(action.name)}, async (${action.params.join(', ')}) => {`,
      );
      for (const line of action.body.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        lines.push(`  ${t}`);
      }
      lines.push(`}, { csrf: false });`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RuneDeclaration {
  name: string;
  kind: '$state' | '$derived' | '$effect' | '$props';
  initializer: string;
}

function extractRuneDeclarations(code: string): RuneDeclaration[] {
  const runes: RuneDeclaration[] = [];
  const re = /(?:let|const)\s+(\w+)\s*=\s*(\$state|\$derived|\$effect|\$props)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    runes.push({
      name: m[1] ?? '',
      kind: (m[2] ?? '$state') as RuneDeclaration['kind'],
      initializer: m[3] ?? '',
    });
  }
  return runes;
}

/** Map Svelte-style rune usage in .nx to Nexus runtime ($state/$derived use `.value`). */
function transformRunesForClientRuntime(script: string): string {
  let s = script.replace(/^\s*"use server"\s*;?\s*$/gm, '// [server-only removed]');
  const bindingNames = new Set(listRuneBindingNames(script));
  s = s.replace(/\blet\s+(\w+)\s*=\s*\$state\b/g, 'const $1 = $state');
  s = s.replace(
    /\b(?:let|const)\s+(\w+)\s*=\s*\$derived\s*\(\s*([^)]+)\s*\)/g,
    (full, name: string, body: string) => {
      const b = body.trim();
      if (b.startsWith('()')) return full.replace(/^\blet\b/, 'const');
      const expr = exprToValueExpr(b, bindingNames);
      return `const ${name} = $derived(() => (${expr}))`;
    },
  );
  return s;
}

function exprToValueExpr(expr: string, bindingNames: Set<string>): string {
  let out = expr.trim();
  for (const name of bindingNames) {
    out = out.replace(
      new RegExp(`\\b${name}\\b(?!\\s*\\.\\s*value)`, 'g'),
      `${name}.value`,
    );
  }
  return out;
}

/** Strip client event handlers and replace `{expr}` with `__NX_i__` + parallel expr functions. */
function processTemplateForClientIsland(
  html: string,
  bindingNames: Set<string>,
): { processed: string; exprLines: string[] } {
  const cleaned = html.replace(/\s+on[a-zA-Z][a-zA-Z0-9-]*\s*=\s*\{[^}]+\}/g, '');
  const exprLines: string[] = [];
  const processed = cleaned.replace(/\{([^}]+)\}/g, (_, raw: string) => {
    const code = exprToValueExpr(raw.trim(), bindingNames);
    const i = exprLines.length;
    exprLines.push(`() => (${code})`);
    return `__NX_${i}__`;
  });
  return { processed, exprLines };
}

function extractDelegatedClickFromFragment(
  html: string,
  stateNames: Set<string>,
): { delegatedClickSelector: string; onDelegatedClick: string } | null {
  const m = /onclick=\{([^}]+)\}/.exec(html);
  if (!m?.[1]) return null;
  const idMatch = /id\s*=\s*"([^"]+)"/.exec(html);
  const delegatedClickSelector = idMatch ? `#${idMatch[1]}` : 'button';
  const onDelegatedClick = rewriteClickHandlerBody(m[1].trim(), stateNames);
  return { delegatedClickSelector, onDelegatedClick };
}

function rewriteClickHandlerBody(body: string, stateNames: Set<string>): string {
  const trimmed = body.trim();
  const arrow = /^\(\s*\)\s*=>\s*(.+)$/.exec(trimmed);
  if (!arrow?.[1]) return trimmed;
  let inner = arrow[1].trim();
  if (inner.endsWith(';')) inner = inner.slice(0, -1);
  for (const name of stateNames) {
    inner = inner.replace(new RegExp(`^${name}\\s*\\+\\+$`), `${name}.value++`);
    inner = inner.replace(new RegExp(`^${name}\\s*--$`), `${name}.value--`);
    inner = inner.replace(new RegExp(`^${name}\\s*=\\s*(.+)$`), `${name}.value = $1`);
  }
  return `() => { ${inner}; }`;
}

const EACH_OPEN = '{#each ';

/**
 * Expands `{#each list as item}...{/each}` into `${list.map((item) => `...`).join('')}`.
 * Inner blocks are expanded first so nesting works.
 */
function expandEachBlocks(template: string): string {
  let t = template;
  while (t.includes(EACH_OPEN)) {
    const start = t.indexOf(EACH_OPEN);
    const closeHeader = t.indexOf('}', start);
    if (closeHeader === -1) return t;

    const header = t.slice(start + EACH_OPEN.length, closeHeader);
    const hm = /^(.+?)\s+as\s+(\w+)\s*$/.exec(header.trim());
    if (!hm || !hm[1] || !hm[2]) return t;

    const listExpr = hm[1].trim();
    const alias = hm[2];

    let depth = 1;
    let pos = closeHeader + 1;
    let closeIdx = -1;
    while (pos < t.length && depth > 0) {
      const subEach = t.indexOf(EACH_OPEN, pos);
      const subEnd = t.indexOf('{/each}', pos);
      if (subEnd === -1) return t;
      if (subEach !== -1 && subEach < subEnd) {
        depth++;
        pos = subEach + EACH_OPEN.length;
      } else {
        depth--;
        if (depth === 0) closeIdx = subEnd;
        else pos = subEnd + 7;
      }
    }
    if (closeIdx === -1) return t;

    const body = t.slice(closeHeader + 1, closeIdx).trim();
    const bodyExpanded = expandEachBlocks(body);
    const inner = interpolateExpressionsForSSR(bodyExpanded);
    const replacement = '${' + listExpr + '.map((' + alias + ') => `' + inner + '`).join(\'\')}';
    t = t.slice(0, start) + replacement + t.slice(closeIdx + 7);
  }
  return t;
}

/**
 * `{foo}` → `${foo}` for the server `return \`...\`` template literal.
 * Skips `<style>` / `<script>` regions so CSS `{ ... }` and JS blocks are not treated as expressions.
 */
function interpolateExpressionsForSSR(s: string): string {
  const interp = (fragment: string): string =>
    fragment.replace(/(?<!\$)\{([^}]+)\}/g, '${$1}');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const low = rest.toLowerCase();
    const styleRel = low.indexOf('<style');
    const scriptRel = low.indexOf('<script');
    let skipFrom = -1;
    let isStyle = true;
    if (styleRel === -1 && scriptRel === -1) {
      out += interp(rest);
      break;
    }
    if (styleRel === -1 || (scriptRel !== -1 && scriptRel < styleRel)) {
      skipFrom = i + scriptRel;
      isStyle = false;
    } else {
      skipFrom = i + styleRel;
      isStyle = true;
    }
    out += interp(s.slice(i, skipFrom));
    const gt = s.indexOf('>', skipFrom);
    if (gt === -1) {
      out += s.slice(skipFrom);
      break;
    }
    const closeTag = isStyle ? '</style>' : '</script>';
    const closeIdx = s.toLowerCase().indexOf(closeTag, gt + 1);
    if (closeIdx === -1) {
      out += s.slice(skipFrom);
      break;
    }
    const blockEnd = closeIdx + closeTag.length;
    out += s.slice(skipFrom, blockEnd);
    i = blockEnd;
  }
  return out;
}

function templateToSSR(template: string): string {
  const attrSafe = transformDynamicAttributesForSSR(template);
  const expanded = expandEachBlocks(attrSafe);
  return interpolateExpressionsForSSR(expanded);
}

/**
 * SSR HTML must not emit unquoted `value=${nick}` (breaks tokenization) or
 * `onsubmit=${fn}` (function `toString()` injects `{}` into the document).
 * Event handlers are omitted here; the client island attaches them on hydrate.
 */
function transformDynamicAttributesForSSR(html: string): string {
  let s = html.replace(/\s+on[a-zA-Z][a-zA-Z0-9-]*\s*=\s*\{[^}]+\}/g, '');
  s = s.replace(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*\{\s*([a-zA-Z_$][\w$.]*)\s*\}/g,
    (_, name: string, expr: string) => `${name}="\${__ssrAttr(${expr})}"`,
  );
  return s;
}

