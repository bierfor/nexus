import type {
  NexusBlock,
  ParsedComponent,
  IslandDirective,
  IslandHydration,
  ServerAction,
} from './types.js';

/** Regex patterns for parsing .nx files */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const SCRIPT_BLOCK_RE = /<script(?:\s[^>]*)?>(\n[\s\S]*?)<\/script>/;
const STYLE_BLOCK_RE = /<style(?:\s[^>]*)?>(\n[\s\S]*?)<\/style>/;
const SERVER_ACTION_RE =
  /(?:export\s+)?async\s+function\s+(\w+)\s*\(([^)]*)\)\s*\{[\s\S]*?"use server"[\s\S]*?\}/g;
const USE_SERVER_FN_RE =
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)"use server"([\s\S]*?)\}/g;

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

  if (fmMatch && fmMatch.index === 0) {
    frontmatter = {
      type: 'server',
      content: fmMatch[1] ?? '',
      start: 0,
      end: fmMatch[0].length,
    };
    remaining = source.slice(fmMatch[0].length);
  }

  // --- Script block ---
  const scriptMatch = SCRIPT_BLOCK_RE.exec(remaining);
  let script: NexusBlock | null = null;
  if (scriptMatch) {
    const absStart = (frontmatter?.end ?? 0) + (scriptMatch.index ?? 0);
    script = {
      type: 'script',
      content: scriptMatch[1] ?? '',
      start: absStart,
      end: absStart + scriptMatch[0].length,
    };
  }

  // --- Style block ---
  const styleMatch = STYLE_BLOCK_RE.exec(remaining);
  let style: NexusBlock | null = null;
  if (styleMatch) {
    const absStart = (frontmatter?.end ?? 0) + (styleMatch.index ?? 0);
    style = {
      type: 'style',
      content: styleMatch[1] ?? '',
      start: absStart,
      end: absStart + styleMatch[0].length,
    };
  }

  // --- Template: everything except frontmatter, script, style ---
  let templateContent = remaining;
  if (scriptMatch) templateContent = templateContent.replace(scriptMatch[0], '');
  if (styleMatch) templateContent = templateContent.replace(styleMatch[0], '');
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
  const scriptContent = script?.content ?? '';
  const frontmatterContent = frontmatter?.content ?? '';
  const serverActions = extractServerActions(scriptContent + '\n' + frontmatterContent);

  if (serverActions.length > 0 && !source.includes('"use server"')) {
    warnings.push(
      `Found server action patterns without "use server" directive in ${filepath}`,
    );
  }

  return {
    source,
    filepath,
    frontmatter,
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

function extractServerActions(code: string): ServerAction[] {
  const actions: ServerAction[] = [];
  const seen = new Set<string>();

  // Match functions that contain "use server"
  const re =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const name = match[1];
    const params = match[2];
    const body = match[3];

    if (!name || !body?.includes('"use server"')) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    actions.push({
      name,
      params: params ? params.split(',').map((p) => p.trim()).filter(Boolean) : [],
      body: body.replace('"use server"', '').trim(),
      returnType: 'Promise<unknown>',
    });
  }

  return actions;
}
