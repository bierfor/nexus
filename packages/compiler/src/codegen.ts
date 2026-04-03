import type {
  ParsedComponent,
  CompileOptions,
  CompileResult,
  IslandManifest,
  IslandEntry,
  ServerAction,
} from './types.js';
import { scopeCSS, scopeTemplate, componentHash } from './css-scope.js';

/** Generates a unique stable island ID from filepath + component name */
function islandId(filepath: string, componentName: string): string {
  const base = filepath.replace(/[^a-zA-Z0-9]/g, '_');
  return `island_${base}_${componentName}`.toLowerCase();
}

/** Compiles a parsed .nx component into server + client output */
export function generate(
  parsed: ParsedComponent,
  opts: CompileOptions,
): CompileResult {
  const warnings = [];

  // ── Server module ──────────────────────────────────────────────────────────
  const serverCode = generateServerModule(parsed, opts);

  // ── Client island code (only if there are reactive islands) ───────────────
  const clientCode =
    parsed.islandDirectives.length > 0 || (parsed.script?.content ?? '').includes('$state')
      ? generateClientIsland(parsed, opts)
      : null;

  // ── CSS (AOT hash scoping — zero runtime) ─────────────────────────────────
  let css: string | null = null;
  let scopedTemplate = parsed.template?.content ?? '';
  if (parsed.style) {
    const scoped = scopeCSS(parsed.style.content, parsed.filepath);
    css = scoped.css;
    // Inject data-nx hash onto template root elements
    scopedTemplate = scopeTemplate(scopedTemplate, scoped.hash);
  }

  // ── Island manifest ────────────────────────────────────────────────────────
  const islandManifest: IslandManifest | null =
    opts.emitIslandManifest && parsed.islandDirectives.length > 0
      ? {
          islands: parsed.islandDirectives.map(
            (d): IslandEntry => ({
              id: islandId(parsed.filepath, d.componentName),
              componentPath: parsed.filepath,
              directive: d.directive,
              props: [],
              mediaQuery: d.mediaQuery,
            }),
          ),
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
function generateServerModule(parsed: ParsedComponent, opts: CompileOptions): string {
  const lines: string[] = [];

  lines.push(`// [Nexus] Server module — generated from ${parsed.filepath}`);
  lines.push(`// DO NOT EDIT — this file is auto-generated`);
  lines.push('');

  // Frontmatter imports + data fetching
  if (parsed.frontmatter) {
    lines.push('// ── Server-only data fetching (runs per request) ──');
    lines.push(parsed.frontmatter.content.trim());
    lines.push('');
  }

  // Extract reactive vars for SSR hydration
  const runes = extractRuneDeclarations(parsed.script?.content ?? '');

  // Build render function
  lines.push('export async function render(ctx) {');
  lines.push('  const __html = await renderTemplate(ctx);');
  lines.push('  return {');
  lines.push('    html: __html,');
  if (runes.length > 0) {
    lines.push(`    props: { ${runes.map((r) => r.name).join(', ')} },`);
  }
  lines.push(`    css: ${parsed.style ? 'true' : 'false'},`);
  lines.push(`    hasIslands: ${parsed.islandDirectives.length > 0},`);
  lines.push('  };');
  lines.push('}');
  lines.push('');

  // Template renderer (simple expression interpolation → SSR)
  lines.push('async function renderTemplate(ctx) {');
  lines.push('  // Server-side template rendering (CSS-scoped at compile time)');
  lines.push(`  return \`${templateToSSR(scopedTemplate)}\`;`);
  lines.push('}');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Client island: sent to browser only for interactive components
// ─────────────────────────────────────────────────────────────────────────────
function generateClientIsland(parsed: ParsedComponent, opts: CompileOptions): string {
  const lines: string[] = [];

  lines.push(`// [Nexus] Client Island — ${parsed.filepath}`);
  lines.push(`// Hydration strategy: ${parsed.islandDirectives.map((d) => d.directive).join(', ') || 'client:load'}`);
  lines.push('');
  lines.push("import { createIsland, $state, $derived, $effect } from '@nexus/runtime/island';");
  lines.push('');

  // Script content with Runes (already Svelte-5-style, pass through)
  if (parsed.script) {
    lines.push('// ── Reactive State (Runes) ──');
    lines.push(transformRunesToRuntime(parsed.script.content));
    lines.push('');
  }

  // Mount function
  lines.push('export function mount(el, props = {}) {');
  lines.push('  return createIsland(el, {');
  lines.push(`    template: ${JSON.stringify(parsed.template?.content ?? '')},`);
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
  lines.push("import { createAction, validateRequest } from '@nexus/server/actions';");
  lines.push('');

  for (const action of actions) {
    lines.push(`/** @nexus-action "${action.name}" */`);
    lines.push(`export const ${action.name} = createAction(async (${action.params.join(', ')}) => {`);
    lines.push(`  await validateRequest();`);
    lines.push('  ' + action.body.split('\n').join('\n  '));
    lines.push(`});`);
    lines.push('');
  }

  // Auto-generate TypeScript types
  lines.push('// Type-safe client stubs (auto-generated)');
  lines.push('export type Actions = {');
  for (const action of actions) {
    lines.push(
      `  ${action.name}: (${action.params.join(', ')}) => ${action.returnType};`,
    );
  }
  lines.push('};');

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

function transformRunesToRuntime(code: string): string {
  // $state(x) → createSignal(x)
  // $derived(expr) → createComputed(() => expr)
  // $effect(() => ...) → createEffect(() => ...)
  return code
    .replace(/\$state\(/g, '__nexus.$state(')
    .replace(/\$derived\(/g, '__nexus.$derived(')
    .replace(/\$effect\(/g, '__nexus.$effect(')
    .replace(/\$props\(/g, '__nexus.$props(');
}

function templateToSSR(template: string): string {
  // Replace {expr} with ${expr} for template literal SSR
  return template
    .replace(/\{([^}]+)\}/g, '${$1}')
    .replace(/`/g, '\\`');
}

