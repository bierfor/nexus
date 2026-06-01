import type {
  NexusBlock,
  ParsedComponent,
  IslandDirective,
  IslandHydration,
  ServerAction,
} from './types.js';
import { extractServerActionsFromSource } from './server-actions-extract.js';
import { splitPretext } from './pretext-extract.js';

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
export function parse(source: string, filepath: string): ParsedComponent {
  const warnings: string[] = [];

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
    warnings.push(
      `Found server action patterns without "use server" directive in ${filepath}`,
    );
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
  };
}

function extractIslandDirectives(template: string): IslandDirective[] {
  const directives: IslandDirective[] = [];

  for (const directive of ISLAND_DIRECTIVES) {
    const re = new RegExp(`<(\\w+)[^>]*\\s${directive}(?:=["']([^"']*)["'])?[^>]*>`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(template)) !== null) {
      const entry: IslandDirective = {
        directive,
        componentName: match[1] ?? 'Unknown',
      };
      if (directive === 'client:media' && match[2] !== undefined) {
        entry.mediaQuery = match[2];
      }
      directives.push(entry);
    }
  }

  return directives;
}
