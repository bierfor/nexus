/**
 * Nexus Preload Scanner — Eliminates island waterfall loading.
 *
 * The waterfall problem:
 *   <Page>            → loads Island A JS
 *     <IslandA>       → renders, then discovers Island B
 *       <IslandB>     → ONLY NOW starts loading Island B JS  ← waterfall!
 *
 * The fix:
 *   At SSR time, the scanner walks the entire component tree and collects
 *   ALL island component paths (including deeply nested ones).
 *   It then emits <link rel="modulepreload"> for each, so the browser
 *   fetches them in parallel while parsing the initial HTML.
 *
 *   Result: Island A and Island B both start loading immediately,
 *   even if B is nested inside A.
 *
 * Algorithm:
 *   1. Parse the template for component references (<ComponentName ...>)
 *   2. For each component that resolves to a .nx file, compile it
 *   3. If it has islands, record their client bundle paths
 *   4. Recurse into imported components
 *   5. Deduplicate and emit modulepreload links
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { parse } from './parser.js';

export interface PreloadEntry {
  /** Absolute path to the island's client bundle */
  modulePath: string;
  /** Relative URL path (for <link rel="modulepreload" href="..."> */
  href: string;
  /** Hydration strategy (determines fetch priority) */
  strategy: string;
  /** Component name for debugging */
  component: string;
}

export interface PreloadScanResult {
  /** All preload entries, deduplicated and sorted by priority */
  entries: PreloadEntry[];
  /** HTML string of <link> tags ready to inject into <head> */
  linkTags: string;
  /** Total number of islands discovered */
  islandCount: number;
}

// Priority order for fetch (load > idle > visible > media)
const STRATEGY_PRIORITY: Record<string, number> = {
  'client:load': 0,
  'client:idle': 1,
  'client:visible': 2,
  'client:media': 3,
  'server:only': 99,
};

/**
 * Scans a route file and all its imported components recursively.
 * Returns modulepreload entries for every island in the tree.
 */
export async function scanPreloads(
  filepath: string,
  opts: { root: string; publicBase?: string; maxDepth?: number },
): Promise<PreloadScanResult> {
  const publicBase = opts.publicBase ?? '/_nexus/islands';
  const maxDepth = opts.maxDepth ?? 8;
  const visited = new Set<string>();
  const entries: PreloadEntry[] = [];

  await walkComponent(filepath, opts.root, publicBase, maxDepth, 0, visited, entries);

  // Sort by hydration strategy priority
  entries.sort((a, b) =>
    (STRATEGY_PRIORITY[a.strategy] ?? 99) - (STRATEGY_PRIORITY[b.strategy] ?? 99),
  );

  const linkTags = entries.map((e) => buildPreloadTag(e)).join('\n  ');

  return { entries, linkTags, islandCount: entries.length };
}

async function walkComponent(
  filepath: string,
  root: string,
  publicBase: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>,
  entries: PreloadEntry[],
): Promise<void> {
  if (depth > maxDepth) return;
  if (visited.has(filepath)) return;
  visited.add(filepath);

  let source: string;
  try {
    source = await readFile(filepath, 'utf-8');
  } catch {
    return; // File not found — skip
  }

  const parsed = parse(source, filepath);

  // Collect islands from this component
  for (const directive of parsed.islandDirectives) {
    if (directive.directive === 'server:only') continue;

    const relPath = relative(root, filepath);
    const href = `${publicBase}/${relPath.replace(/\.nx$/, '.client.js')}`;

    entries.push({
      modulePath: filepath,
      href,
      strategy: directive.directive,
      component: directive.componentName,
    });
  }

  // Find and recurse into imported components
  const importedPaths = extractComponentImports(source, filepath, root);
  for (const importedPath of importedPaths) {
    await walkComponent(importedPath, root, publicBase, maxDepth, depth + 1, visited, entries);
  }
}

/**
 * Extracts .nx component imports from a file's frontmatter and script block.
 * Resolves them relative to the current file.
 */
function extractComponentImports(source: string, filepath: string, root: string): string[] {
  const dir = dirname(filepath);
  const resolved: string[] = [];

  // Match: import X from './Foo.nx' or import './Foo.nx'
  const importRe = /import\s+(?:\w+\s+from\s+)?['"]([^'"]+\.nx)['"]/g;
  let m: RegExpExecArray | null;

  while ((m = importRe.exec(source)) !== null) {
    const spec = m[1];
    if (!spec) continue;

    let absPath: string;
    if (spec.startsWith('.')) {
      absPath = resolve(dir, spec);
    } else if (spec.startsWith('$')) {
      // $lib/* alias
      absPath = resolve(root, 'src', spec.slice(1), '.nx');
    } else {
      continue; // External package — skip
    }

    if (!absPath.endsWith('.nx')) absPath += '.nx';
    resolved.push(absPath);
  }

  // Also scan template for <ComponentName /> patterns
  // These may map to co-located .nx files
  const componentRe = /<([A-Z][a-zA-Z0-9]*)\s/g;
  while ((m = componentRe.exec(source)) !== null) {
    const name = m[1];
    if (!name) continue;

    // Try conventional co-location paths
    const candidates = [
      join(dir, `${name}.nx`),
      join(dir, 'components', `${name}.nx`),
      join(root, 'src', 'components', `${name}.nx`),
    ];

    for (const candidate of candidates) {
      resolved.push(candidate); // walkComponent will skip non-existent files
    }
  }

  return [...new Set(resolved)];
}

/**
 * Builds a <link rel="modulepreload"> tag with correct fetch priority.
 */
function buildPreloadTag(entry: PreloadEntry): string {
  const priority = entry.strategy === 'client:load' ? ' fetchpriority="high"' : '';
  const asAttr = ' as="script"';
  return `<link rel="modulepreload" href="${entry.href}"${asAttr}${priority}>`;
}

/**
 * Quick synchronous scan — for use inside the compiler during codegen.
 * Returns preload hrefs from already-parsed island directives.
 */
export function buildPreloadTagsFromManifest(
  islands: Array<{ componentPath: string; directive: string }>,
  root: string,
  publicBase = '/_nexus/islands',
): string {
  const tags = islands
    .filter((i) => i.directive !== 'server:only')
    .sort((a, b) =>
      (STRATEGY_PRIORITY[a.directive] ?? 99) - (STRATEGY_PRIORITY[b.directive] ?? 99),
    )
    .map((island) => {
      const relPath = relative(root, island.componentPath);
      const href = `${publicBase}/${relPath.replace(/\.nx$/, '.client.js')}`;
      const priority = island.directive === 'client:load' ? ' fetchpriority="high"' : '';
      return `<link rel="modulepreload" href="${href}" as="script"${priority}>`;
    });

  return tags.join('\n  ');
}
