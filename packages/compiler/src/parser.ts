import type {
  NexusBlock,
  ParsedComponent,
  IslandDirective,
  IslandHydration,
  ServerAction,
  CompileWarning,
  SourceLocation,
} from './types.js';
import { extractServerActionsFromSource } from './server-actions-extract.js';
import { splitPretext } from './pretext-extract.js';

/** Convert a character offset into 1-based line and 0-based column numbers. */
export function offsetToLineColumn(source: string, offset: number): SourceLocation {
  let line = 1;
  let column = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

/** Regex patterns for parsing .nx files */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const SCRIPT_BLOCK_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
const STYLE_BLOCK_RE = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g;

const ISLAND_DIRECTIVES: IslandHydration[] = [
  'client:load',
  'client:idle',
  'client:visible',
  'client:media',
  'server:only',
];

/**
 * Parses a .nx source file into its constituent blocks.
 * A .nx file has the structure:
 *
 * ```
 * ---
 * // Server-only frontmatter (Astro-style)
 * import { db } from '$lib/db';
 * const user = await db.user.findFirst();
 * ---
 *
 * <script>
 *   // Svelte 5 Runes-style reactive script
 *   let count = $state(0);
 *   let doubled = $derived(count * 2);
 * </script>
 *
 * <h1>Hello {user.name}</h1>
 * <button onclick={() => count++}>Clicked {count}</button>
 *
 * <style>
 *   h1 { color: red; }
 * </style>
 * ```
 */
export interface ParseResult extends ParsedComponent {
  warnings: CompileWarning[];
}

export function parse(source: string, filepath: string): ParseResult {
  const warnings: CompileWarning[] = [];

  // --- Frontmatter ---
  const fmMatch = FRONTMATTER_RE.exec(source);
  let frontmatter: NexusBlock | null = null;
  let remaining = source;
  let pretext: string | null = null;

  if (fmMatch && fmMatch.index === 0) {
    const rawFm = fmMatch[1] ?? '';
    const split = splitPretext(rawFm);
    pretext = split.pretext;
    const mergedServer = [split.leading, split.server].filter(Boolean).join('\n\n');
    frontmatter = {
      type: 'server',
      content: mergedServer,
      start: 0,
      end: fmMatch[0].length,
    };
    remaining = source.slice(fmMatch[0].length);
  }

  // --- Script blocks (collect ALL) ---
  const scriptMatches = Array.from(remaining.matchAll(SCRIPT_BLOCK_RE));
  const scriptContents: string[] = [];
  let scriptStart = -1;
  let scriptEnd = -1;
  for (const m of scriptMatches) {
    scriptContents.push(m[1] ?? '');
    const absStart = (frontmatter?.end ?? 0) + (m.index ?? 0);
    const absEnd = absStart + m[0].length;
    if (scriptStart === -1) scriptStart = absStart;
    scriptEnd = Math.max(scriptEnd, absEnd);
  }
  const script: NexusBlock | null =
    scriptContents.length > 0
      ? {
          type: 'script',
          content: scriptContents.join('\n\n'),
          start: scriptStart,
          end: scriptEnd,
        }
      : null;

  // --- Style blocks (collect ALL) ---
  const styleMatches = Array.from(remaining.matchAll(STYLE_BLOCK_RE));
  const styleContents: string[] = [];
  let styleStart = -1;
  let styleEnd = -1;
  for (const m of styleMatches) {
    styleContents.push(m[1] ?? '');
    const absStart = (frontmatter?.end ?? 0) + (m.index ?? 0);
    const absEnd = absStart + m[0].length;
    if (styleStart === -1) styleStart = absStart;
    styleEnd = Math.max(styleEnd, absEnd);
  }
  const style: NexusBlock | null =
    styleContents.length > 0
      ? {
          type: 'style',
          content: styleContents.join('\n\n'),
          start: styleStart,
          end: styleEnd,
        }
      : null;

  // --- Template: everything except frontmatter, script, style ---
  let templateContent = remaining;
  for (const m of scriptMatches) templateContent = templateContent.replace(m[0], '');
  for (const m of styleMatches) templateContent = templateContent.replace(m[0], '');
  templateContent = templateContent.trim();

  const template: NexusBlock = {
    type: 'template',
    content: templateContent,
    start: frontmatter?.end ?? 0,
    end: source.length,
  };

  // --- Island directives ---
  const islandDirectives = extractIslandDirectives(templateContent);

  // --- Server Actions ---
  // Include `// nexus:pretext` body: `createAction` / `use server` often live there, not in leading/server merge.
  const scriptContent = script?.content ?? '';
  const frontmatterContent = frontmatter?.content ?? '';
  const pretextContent = pretext ?? '';
  const serverActions = extractServerActionsFromSource(
    scriptContent + '\n' + frontmatterContent + '\n' + pretextContent,
  );

  if (serverActions.length > 0 && !source.includes('use server')) {
    const loc = offsetToLineColumn(source, source.indexOf(serverActions[0]!.name) || 0);
    warnings.push({
      code: 'NX-001',
      severity: 'warning',
      message: `Found server action patterns without "use server" directive`,
      hint: `Add "use server" at the top of your server action function, or use createAction() from @nexus_js/server.`,
      loc,
    });
  }

  return {
    source,
    filepath,
    frontmatter,
    pretext: pretext ?? null,
    script,
    template,
    style,
    islandDirectives,
    serverActions,
    warnings,
  };
}

function extractIslandDirectives(template: string): IslandDirective[] {
  const directives: IslandDirective[] = [];

  // Scan opening tags one-by-one, then parse individual attributes so we never
  // match a directive that lives inside an attribute value
  // (e.g. data-tip="use client:load for interactivity").
  const tagRe = /<([a-zA-Z][\w-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(template)) !== null) {
    const tagName = m[1]!;
    const attrs = m[2]!;

    // Extract attribute names and optional values one-by-one
    const attrRe = /\s([a-zA-Z][\w:-]*)(?:="([^"]*)")?(?:='([^']*)')?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrs)) !== null) {
      const attrName = am[1]!;
      if (ISLAND_DIRECTIVES.includes(attrName as IslandHydration)) {
        const entry: IslandDirective = {
          directive: attrName as IslandHydration,
          componentName: tagName,
        };
        if (entry.directive === 'client:media') {
          const val = am[2] ?? am[3];
          if (val !== undefined) entry.mediaQuery = val;
        }
        directives.push(entry);
        break; // a tag can carry at most one island directive
      }
    }
  }

  return directives;
}
