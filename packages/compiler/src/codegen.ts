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
import { basename, join, normalize, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scopeCSS, scopeTemplate, unwrapOuterTemplateElement } from './css-scope.js';
import { wrapSelfClientIslandMarkers, type IslandWrapResult } from './island-wrap.js';
import { scanSelfClientIslandTemplateWarnings } from './island-template-warnings.js';
import {
  islandSsrStubLines,
  listRuneBindingNames,
  extractDollarStateInitializers,
} from './island-ssr-stubs.js';
import { transformPretextExport } from './pretext-extract.js';
import { scanIslandSecurity } from './client-security-scan.js';

/** Generates a unique stable island ID from filepath + component name */
function islandId(filepath: string, componentName: string): string {
  const base = filepath.replace(/[^a-zA-Z0-9]/g, '_');
  return `island_${base}_${componentName}`.toLowerCase();
}

/** Extension preference for dev (source-first) and prod (compiled-first). */
const LIB_IMPORT_EXT_DEV  = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'] as const;
const LIB_IMPORT_EXT_PROD = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts'] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `export const x = createAction` so the generated `*.actions.mjs` can import the same
 * binding SSR uses — otherwise registerAction patches a duplicate wrapper instance.
 */
function exportCreateActionBindingsInSource(source: string, names: Set<string>): string {
  let out = source;
  for (const name of names) {
    const re = new RegExp(
      `(^|\\n)(\\s*)(?:export\\s+)?(const)\\s+(${escapeRegExp(name)})\\s*=\\s*createAction\\b`,
      'gm',
    );
    out = out.replace(re, '$1$2export $3 $4 = createAction');
  }
  return out;
}

/**
 * Server bundle filename adjacent to `*.actions.{mjs,js}`.
 * Dev must match `devServerCachePath` in packages/server load-module.ts (`+` → `_` in the rel path).
 */
function actionsServerImportFilename(opts: CompileOptions, filepath: string): string {
  if (opts.dev) {
    if (opts.appRoot) {
      const rel = relative(normalize(opts.appRoot), normalize(filepath));
      const safe = rel.replace(/[^a-zA-Z0-9._/-]/g, '_');
      return basename(safe + '.mjs');
    }
    return basename(filepath).replace(/[^a-zA-Z0-9._/-]/g, '_') + '.mjs';
  }
  const p = opts.routePattern ?? '';
  const seg = p === '/' ? 'index' : p.replace(/^\//u, '');
  const full = seg || basename(filepath).replace(/\.nx$/u, '');
  // The sidecar is ADJACENT to the server module, so use only the last path segment.
  // e.g. pattern "/auth/login" → server: ".nexus/output/auth/login.js"
  //                             → sidecar: ".nexus/output/auth/login.actions.js"
  //                             → import:  "./login.js"  (not "./auth/login.js")
  return `${basename(full)}.js`;
}

/**
 * Resolve `$lib/…` to an on-disk path so Node ESM can load it.
 *
 * Production (`!dev`): checks `.nexus/lib/` (compiled JS output) first so Node
 * never tries to execute raw `.ts` source files.  Falls back to `src/lib/` with
 * JS-first extension order for apps that ship pre-compiled lib files.
 *
 * Dev: prefers the TypeScript source (works with tsx / Node --experimental-strip-types).
 */
function resolveDollarLibFilePath(appRoot: string, rel: string, dev: boolean): string {
  const root = normalize(appRoot);
  const hasKnownExt = /\.(ts|tsx|mts|js|mjs|cjs)$/u.test(rel);

  // Production: prefer the pre-compiled .nexus/lib/ output emitted by `nexus build`.
  if (!dev) {
    const nexusLibBase = join(root, '.nexus', 'lib', rel);
    // Check with .ts → .js substitution first.
    const nexusLibJs = hasKnownExt
      ? nexusLibBase.replace(/\.(ts|tsx|mts)$/u, '.js')
      : nexusLibBase + '.js';
    if (existsSync(nexusLibJs)) return nexusLibJs;
    if (existsSync(nexusLibBase)) return nexusLibBase;
  }

  const abs = join(root, 'src/lib', rel);
  if (existsSync(abs)) return abs;
  if (hasKnownExt) return abs;

  const order = dev ? LIB_IMPORT_EXT_DEV : LIB_IMPORT_EXT_PROD;
  for (const ext of order) {
    const candidate = abs + ext;
    if (existsSync(candidate)) return candidate;
  }
  // Fallback: .ts in dev (needs tsx), .js in prod (will warn at runtime if missing).
  return abs + (dev ? '.ts' : '.js');
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
    const abs = resolveDollarLibFilePath(root, rel, !!opts.dev);
    const href = pathToFileURL(abs).href + libBust;
    return `from ${JSON.stringify(href)}`;
  });
}

/** Compiles a parsed .nx component into server + client output */
export function generate(
  parsed: ParsedComponent,
  opts: CompileOptions,
): CompileResult {
  const warnings: CompileWarning[] = [...scanIslandSecurity(parsed)];

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
  warnings.push(...scanSelfClientIslandTemplateWarnings(islandWrap, parsed.filepath));

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
      ? generateActionsModule(parsed.serverActions, parsed.filepath, opts)
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

  const createActionBindingNames = new Set(
    parsed.serverActions.filter((a) => a.createActionSource).map((a) => a.name),
  );

  // Leading imports + // nexus:server first so `export const x = createAction` in pretext closes over $lib.
  if (parsed.frontmatter) {
    lines.push('// ── Imports & server-only (leading + // nexus:server) ──');
    lines.push(
      rewriteDollarLibImports(
        exportCreateActionBindingsInSource(parsed.frontmatter.content.trim(), createActionBindingNames),
        opts,
      ),
    );
    lines.push('');
  }

  if (parsed.pretext) {
    lines.push('// ── Pretext — merged into ctx.pretext (parallel across layout + page before render) ──');
    lines.push(
      rewriteDollarLibImports(
        exportCreateActionBindingsInSource(transformPretextExport(parsed.pretext), createActionBindingNames),
        opts,
      ),
    );
    lines.push('');
  }

  // ── "use server" action exports ────────────────────────────────────────────
  // Export each inline action as a named function so the sidecar can import it.
  // This keeps the $lib imports in scope (they live in the same module) and
  // avoids duplicating imports or inlining bodies into the sidecar.
  const inlineActions = parsed.serverActions.filter((a) => !a.createActionSource);
  for (const action of inlineActions) {
    lines.push(`// ── Server Action export: ${action.name} ──`);
    lines.push(`export async function __nexus_action_${action.name}(${action.params.join(', ')}) {`);
    for (const line of action.body.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      lines.push(`  ${t}`);
    }
    lines.push('}');
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
  // Concat — not nested template literal: SSR body can contain `` ` `` and `${` (nested if/each).
  const actionNamesForSsr = new Set(parsed.serverActions.map((a) => a.name));
  lines.push('  return ' + '`' + templateToSSR(processedTemplate, actionNamesForSsr) + '`;');
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

  const actionNamesForClient = new Set(parsed.serverActions.map((a) => a.name));
  const processedFragments: string[] = [];
  const exprFnBlocks: string[][] = [];
  for (const frag of fragments) {
    const { processed, exprLines } = processTemplateForClientIsland(frag, bindingNames, actionNamesForClient);
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

  const delegatedSubmits = fragments.map((frag) => extractDelegatedSubmitFromFragment(frag));

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

  lines.push('const __nxDelegatedSubmit = [');
  for (const s of delegatedSubmits) {
    if (!s) {
      lines.push('  null,');
      continue;
    }
    lines.push(
      `  { delegatedSubmitFormId: ${JSON.stringify(s.delegatedSubmitFormId)}, onDelegatedSubmit: () => { void ${s.handlerName}(); } },`,
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
  lines.push('    ...(__nxDelegatedSubmit[idx] ?? {}),');
  lines.push('    ...props,');
  lines.push('  });');
  lines.push('}');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Actions module: imports handlers from server module + registers them
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generates the sidecar `*.actions.{mjs,js}` file.
 *
 * All action implementations are imported from the co-located server module
 * (which has the $lib imports in scope):
 *   - `createAction` bindings → imported by their original name
 *   - `"use server"` functions → imported as `__nexus_action_<name>` (exported
 *     by the server module via `generateServerModule`)
 *
 * This design means the sidecar never needs its own $lib imports — the server
 * module already has everything in scope, and the handler runs there.
 */
function generateActionsModule(actions: ServerAction[], filepath: string, opts: CompileOptions): string {
  const lines: string[] = [];

  lines.push(`// [Nexus] Server Actions — generated from ${filepath}`);
  lines.push(`"use server";`);
  lines.push('');
  lines.push("import { registerAction } from '@nexus_js/server/actions';");
  lines.push('');

  // Build the import specifier list: createAction → original name, "use server" → __nexus_action_*
  const importSpecifiers: string[] = [];
  for (const action of actions) {
    importSpecifiers.push(action.createActionSource ? action.name : `__nexus_action_${action.name}`);
  }

  const serverFile = actionsServerImportFilename(opts, filepath);
  lines.push(`import { ${importSpecifiers.join(', ')} } from ${JSON.stringify('./' + serverFile)};`);
  lines.push('');

  for (const action of actions) {
    lines.push(`/** @nexus-action "${action.name}" */`);
    if (action.createActionSource) {
      lines.push(`registerAction(${JSON.stringify(action.name)}, ${action.name});`);
    } else {
      lines.push(`registerAction(${JSON.stringify(action.name)}, __nexus_action_${action.name});`);
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

/**
 * After `let x = $state` → `const x = $state`, assignments like `x = 1` must become
 * `x.value = 1`. Plain `x =` reassigns a const and throws at runtime (e.g. auth forms).
 */
function transformStateAssignmentsForClientScript(script: string): string {
  const stateNames = extractDollarStateInitializers(script).keys();
  let s = script;
  for (const name of stateNames) {
    const re = new RegExp(String.raw`(?<!const )\b${name}\s*=(?!=)`, 'g');
    s = s.replace(re, `${name}.value =`);
  }
  return s;
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
  s = transformStateAssignmentsForClientScript(s);
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

/**
 * HTML5 boolean attributes: presence means true — `disabled="false"` still disables.
 * Emit `disabled` only when truthy: `${expr ? ' disabled' : ''}` (same order as `{expr}` in file).
 */
function interpolateClientIslandPlaceholders(
  html: string,
  bindingNames: Set<string>,
  exprLines: string[],
): string {
  const re =
    /\b(disabled|checked|readonly|required|selected|multiple|autofocus|open)\s*=\s*\{\s*([a-zA-Z_$][\w$]*)\s*\}|(?<!\$)\{([^}]+)\}/g;
  return html.replace(re, (full, g1: string | undefined, g2: string | undefined, g3: string | undefined) => {
    const idx = exprLines.length;
    if (g1 !== undefined && g2 !== undefined) {
      const expr = exprToValueExpr(g2.trim(), bindingNames);
      exprLines.push(`() => (${expr}) ? ' ${g1}' : ''`);
      return `__NX_${idx}__`;
    }
    if (g3 !== undefined) {
      const code = exprToValueExpr(g3.trim(), bindingNames);
      exprLines.push(`() => (${code})`);
      return `__NX_${idx}__`;
    }
    return full;
  });
}

/** Strip client event handlers and replace `{expr}` with `__NX_i__` + parallel expr functions. */
function processTemplateForClientIsland(
  html: string,
  bindingNames: Set<string>,
  actionNames?: Set<string>,
): { processed: string; exprLines: string[] } {
  const cleaned = html.replace(/\s+on[a-zA-Z][a-zA-Z0-9-]*\s*=\s*\{[^}]+\}/g, '');
  const withActions = rewriteServerActionHtmlActionAttr(cleaned, actionNames);
  const controlFlowExpanded = expandEachBlocks(expandIfBlocks(withActions));
  const exprLines: string[] = [];
  const processed = interpolateClientIslandPlaceholders(controlFlowExpanded, bindingNames, exprLines);
  return { processed, exprLines };
}

/** Length of `<tag ...>` from `start` (at `<`), quote-aware so `>` in strings does not close early. */
function openingTagScanLength(html: string, start: number): number {
  if (html[start] !== '<') return 0;
  let quote: '"' | "'" | null = null;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i - start + 1;
  }
  return 0;
}

/**
 * Resolves `#id` for delegated click from the same opening tag that carries `onclick`, not the first `id` in the
 * fragment (forms often put `<input id=…>` before `<button onclick=…>`).
 */
function extractDelegatedClickFromFragment(
  html: string,
  stateNames: Set<string>,
): { delegatedClickSelector: string; onDelegatedClick: string } | null {
  const m = /onclick=\{([^}]+)\}/.exec(html);
  if (!m?.[1]) return null;
  const onclickIdx = m.index ?? 0;

  let delegatedClickSelector = 'button';

  outer: for (const tag of ['button', 'a'] as const) {
    const re = new RegExp(`<${tag}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const s = match.index;
      const len = openingTagScanLength(html, s);
      if (len === 0) continue;
      if (onclickIdx < s || onclickIdx >= s + len) continue;
      const openTag = html.slice(s, s + len);
      const idMatch = /\bid\s*=\s*"([^"]+)"/.exec(openTag);
      if (idMatch?.[1]) delegatedClickSelector = `#${idMatch[1]}`;
      else delegatedClickSelector = tag === 'a' ? 'a' : 'button';
      break outer;
    }
  }

  const onDelegatedClick = rewriteClickHandlerBody(m[1].trim(), stateNames);
  return { delegatedClickSelector, onDelegatedClick };
}

const DATA_NEXUS_SUBMIT_RE = /data-nexus-submit\s*=\s*"(\w+)"/;

/**
 * `<form id="…" data-nexus-submit="handlerName">` — submit is delegated on the stable island root so it survives
 * reactive `outerHTML` updates (listeners on the form element alone are lost each tick).
 */
function extractDelegatedSubmitFromFragment(
  html: string,
): { delegatedSubmitFormId: string; handlerName: string } | null {
  const formOpen = /<form\b[^>]*>/.exec(html);
  if (!formOpen?.[0]) return null;
  const openTag = formOpen[0];
  const idMatch = /\bid\s*=\s*"([^"]+)"/.exec(openTag);
  const submitMatch = DATA_NEXUS_SUBMIT_RE.exec(openTag);
  if (!idMatch?.[1] || !submitMatch?.[1]) return null;
  return { delegatedSubmitFormId: idMatch[1], handlerName: submitMatch[1] };
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
const IF_OPEN = '{#if ';
const ELSE_IF_OPEN = '{:else if ';

/**
 * Index of the `}` that closes `{#if expr}`, `{:else if expr}`, or `{#each expr as x}` when `expr`
 * may contain `}`, e.g. `.filter((r) => r.x)`. Plain `indexOf('}', start)` breaks those tags.
 */
function findBlockTagExprEnd(t: string, exprStart: number): number {
  let curly = 0;
  let paren = 0;
  let bracket = 0;
  let i = exprStart;
  while (i < t.length) {
    const c = t[i]!;
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < t.length) {
        const ch = t[i]!;
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < t.length) {
        const ch = t[i]!;
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '`') {
          i++;
          break;
        }
        if (ch === '$' && t[i + 1] === '{') {
          const nest = findBlockTagExprEnd(t, i + 2);
          if (nest < 0) return -1;
          i = nest + 1;
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === '/' && t[i + 1] === '/') {
      i += 2;
      while (i < t.length && t[i] !== '\n' && t[i] !== '\r') i++;
      continue;
    }
    switch (c) {
      case '(':
        paren++;
        break;
      case ')':
        if (paren > 0) paren--;
        break;
      case '[':
        bracket++;
        break;
      case ']':
        if (bracket > 0) bracket--;
        break;
      case '{':
        curly++;
        break;
      case '}':
        if (curly > 0) {
          curly--;
        } else if (paren === 0 && bracket === 0) {
          return i;
        }
        break;
      default:
        break;
    }
    i++;
  }
  return -1;
}

/**
 * Parse one `{#if}...{:else if}...{:else}...{/if}` starting at `openIdx` (must point at `{#if `).
 * Nested `{#if}` inside branches is handled via depth counting.
 */
function parseTopLevelIfBlock(
  t: string,
  openIdx: number,
): { closeEnd: number; branches: Array<{ cond: string | null; body: string }> } | null {
  if (!t.startsWith(IF_OPEN, openIdx)) return null;
  const condStart = openIdx + IF_OPEN.length;
  const condEnd = findBlockTagExprEnd(t, condStart);
  if (condEnd < 0) return null;
  const firstCond = t.slice(condStart, condEnd).trim();

  const branches: Array<{ cond: string | null; body: string }> = [];
  let currentCond: string | null = firstCond;
  let bodyStart = condEnd + 1;
  let depth = 1;
  let i = bodyStart;

  while (i < t.length && depth >= 1) {
    const pIf = t.indexOf(IF_OPEN, i);
    const pClose = t.indexOf('{/if}', i);

    let pElseIf = -1;
    let pElse = -1;
    if (depth === 1) {
      pElseIf = t.indexOf(ELSE_IF_OPEN, i);
      let pe = t.indexOf('{:else}', i);
      while (pe !== -1 && t.startsWith(ELSE_IF_OPEN, pe)) {
        pe = t.indexOf('{:else}', pe + 1);
      }
      pElse = pe;
    }

    type Tok = 'if' | 'close' | 'elseif' | 'else';
    let nextPos = Infinity;
    let kind: Tok | null = null;

    const cand = (p: number, k: Tok) => {
      if (p !== -1 && p >= i && p < nextPos) {
        nextPos = p;
        kind = k;
      }
    };

    cand(pIf, 'if');
    cand(pClose, 'close');
    cand(pElseIf, 'elseif');
    cand(pElse, 'else');

    if (kind === null || nextPos === Infinity) return null;

    if (kind === 'if' && pIf === nextPos) {
      depth++;
      const hEnd = findBlockTagExprEnd(t, pIf + IF_OPEN.length);
      if (hEnd < 0) return null;
      i = hEnd + 1;
      continue;
    }

    if (kind === 'close' && pClose === nextPos) {
      depth--;
      if (depth === 0) {
        branches.push({ cond: currentCond, body: t.slice(bodyStart, pClose) });
        return { closeEnd: pClose + '{/if}'.length, branches };
      }
      i = pClose + '{/if}'.length;
      continue;
    }

    if (depth === 1 && kind === 'elseif' && pElseIf === nextPos) {
      branches.push({ cond: currentCond, body: t.slice(bodyStart, pElseIf) });
      const cStart = pElseIf + ELSE_IF_OPEN.length;
      const cEnd = findBlockTagExprEnd(t, cStart);
      if (cEnd < 0) return null;
      currentCond = t.slice(cStart, cEnd).trim();
      bodyStart = cEnd + 1;
      i = bodyStart;
      continue;
    }

    if (depth === 1 && kind === 'else' && pElse === nextPos) {
      branches.push({ cond: currentCond, body: t.slice(bodyStart, pElse) });
      currentCond = null;
      bodyStart = pElse + '{:else}'.length;
      i = bodyStart;
      continue;
    }

    return null;
  }

  return null;
}

function buildIfTernary(branches: Array<{ cond: string | null; body: string }>): string {
  if (branches.length === 0) return '';

  function aux(idx: number): string {
    const b = branches[idx]!;
    const last = idx === branches.length - 1;
    if (last) {
      if (b.cond === null) {
        return '`' + b.body + '`';
      }
      return b.cond + ' ? `' + b.body + '` : \'\'';
    }
    if (b.cond === null) {
      return '`' + b.body + '`';
    }
    return b.cond + ' ? `' + b.body + '` : (' + aux(idx + 1) + ')';
  }

  return '${' + aux(0) + '}';
}

/**
 * Turns Svelte-style `{#if}` / `{:else if}` / `{:else}` into JS template ternary fragments.
 * Must run before `interpolateExpressionsForSSR` — otherwise `{#if x}` is mistaken for `{expr}` and emits `${#if` (invalid private field `#if`).
 */
function expandIfBlocks(template: string): string {
  if (!template.includes(IF_OPEN)) return template;
  const open = template.indexOf(IF_OPEN);
  const parsed = parseTopLevelIfBlock(template, open);
  if (!parsed) return template;
  const expandedBranches = parsed.branches.map(({ cond, body }) => ({
    cond,
    body: expandIfBlocks(body.trim()),
  }));
  const piece = buildIfTernary(expandedBranches);
  const next = template.slice(0, open) + piece + template.slice(parsed.closeEnd);
  return expandIfBlocks(next);
}

/**
 * Expands `{#each list as item}...{/each}` into `${list.map((item) => `...`).join('')}`.
 * Inner blocks are expanded first so nesting works.
 */
function expandEachBlocks(template: string): string {
  let t = template;
  while (t.includes(EACH_OPEN)) {
    const start = t.indexOf(EACH_OPEN);
    const closeHeader = findBlockTagExprEnd(t, start + EACH_OPEN.length);
    if (closeHeader < 0) return t;

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
        const innerHdrEnd = findBlockTagExprEnd(t, subEach + EACH_OPEN.length);
        if (innerHdrEnd < 0) return t;
        pos = innerHdrEnd + 1;
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
 * But DOES interpolate expressions inside attributes (like `nonce="{pretext.cspNonce}"`).
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
    // Interpolate the opening <script> or <style> tag (for attributes like nonce="{pretext.cspNonce}")
    const gt = s.indexOf('>', skipFrom);
    if (gt === -1) {
      out += interp(s.slice(i));
      break;
    }
    const openTag = s.slice(skipFrom, gt + 1);
    out += interp(s.slice(i, skipFrom)) + interp(openTag);
    
    const closeTag = isStyle ? '</style>' : '</script>';
    const closeIdx = s.toLowerCase().indexOf(closeTag, gt + 1);
    if (closeIdx === -1) {
      // If no closing tag, just append the rest without interpolation (treat as code)
      out += s.slice(gt + 1);
      break;
    }
    // Content between <script>...</script> or <style>...</style> is NOT interpolated
    const blockEnd = closeIdx + closeTag.length;
    out += s.slice(gt + 1, blockEnd);
    i = blockEnd;
  }
  return out;
}

function templateToSSR(template: string, actionNames?: Set<string>): string {
  const attrSafe = transformDynamicAttributesForSSR(template, actionNames);
  const ifExpanded = expandIfBlocks(attrSafe);
  const expanded = expandEachBlocks(ifExpanded);
  return interpolateExpressionsForSSR(expanded);
}

/** Registered server actions post to `/_nexus/action/:name` (see packages/server actions). */
const SERVER_ACTION_URL_PREFIX = '/_nexus/action/';

/**
 * `action={myAction}` must not flow through SSR __ssrAttr(fn) or island String(fn) — both stringify the handler.
 * Simple identifier + extracted server action name → static action URL.
 */
function rewriteServerActionHtmlActionAttr(html: string, actionNames?: Set<string>): string {
  if (!actionNames?.size) return html;
  return html.replace(
    /\baction\s*=\s*\{\s*([a-zA-Z_$][\w$]*)\s*\}/g,
    (full, name: string) =>
      actionNames.has(name) ? `action="${SERVER_ACTION_URL_PREFIX}${name}"` : full,
  );
}

/**
 * SSR HTML must not emit unquoted `value=${nick}` (breaks tokenization) or
 * `onsubmit=${fn}` (function `toString()` injects `{}` into the document).
 * Event handlers are omitted here; the client island attaches them on hydrate.
 */
function transformDynamicAttributesForSSR(html: string, actionNames?: Set<string>): string {
  let s = html.replace(/\s+on[a-zA-Z][a-zA-Z0-9-]*\s*=\s*\{[^}]+\}/g, '');
  s = rewriteServerActionHtmlActionAttr(s, actionNames);
  // Boolean attributes: omit when falsy (HTML5 — presence disables even if value is "false").
  s = s.replace(
    /\b(disabled|checked|readonly|required|selected|multiple|autofocus|open)\s*=\s*\{\s*([a-zA-Z_$][\w$]*)\s*\}/g,
    (_full: string, name: string, expr: string) => '${' + expr + " ? ' " + name + "' : ''}",
  );
  s = s.replace(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*\{\s*([a-zA-Z_$][\w$.]*)\s*\}/g,
    (_, name: string, expr: string) => `${name}="\${__ssrAttr(${expr})}"`,
  );
  return s;
}

