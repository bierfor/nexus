/**
 * Splits `.nx` server frontmatter into pretext data-loader region and other server code.
 *
 * The simple form (recommended, no marker needed):
 * ```
 * ---
 * import { db } from '$lib/db';
 * export async function load(ctx) {
 *   return { flow: await db.flows.findFirst() };
 * }
 * ---
 * ```
 *
 * Explicit marker form (when you also need top-level server-only code):
 * ```
 * ---
 * import { db } from '$lib/db';
 * // nexus:pretext
 * export async function load(ctx) { ... }
 * // nexus:server
 * defineHead({ title: '…' });
 * ---
 * ```
 */

export interface PretextSplitResult {
  /** Code before `// nexus:pretext` (usually imports shared by pretext + server). */
  leading: string;
  /** Body of the pretext export (async function / const). */
  pretext: string | null;
  /** Code after `// nexus:server` (runs at module top level, same as today). */
  server: string;
}

export function splitPretext(frontmatter: string): PretextSplitResult {
  const lines = frontmatter.split('\n');
  const markerIdx = lines.findIndex((l) => /^\s*\/\/\s*nexus:pretext\s*$/u.test(l));

  if (markerIdx === -1) {
    // Ergonomic auto-detect: support the common documented pattern of just writing
    // `export async function load(ctx) { ... }` (or const load = async ...) without
    // requiring the // nexus:pretext marker.
    //
    // This resolves the major incongruencia between the quickstart/README examples
    // (and paylinks-saas demo) vs the actual pretext machinery.
    //
    // Strategy:
    // - Find the first `load` export declaration.
    // - Everything before it becomes `leading` (imports + shared top-level server code).
    // - The load declaration (and following lines until a logical split) becomes the pretext.
    // - Remaining code after the load block becomes `server` (top-level).
    //
    // Users who need explicit separation between data-loading and other server module code
    // can still use the // nexus:pretext + // nexus:server markers (see PRETEXT.md).
    let loadStart = -1;
    const loadRe = /^\s*export\s+(async\s+)?(function\s+load\b|const\s+load\s*=|default\s+async\s+function\s+load\b)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (loadRe.test(line)) {
        loadStart = i;
        break;
      }
    }

    if (loadStart !== -1) {
      const leading = lines.slice(0, loadStart).join('\n').trim();

      // Take from the load line to the end as pretext for the common case.
      // If there is obvious server-only code after (e.g. another export or top level statement
      // that is not part of load), advanced users should use the marker for clarity.
      const pretextBody = lines.slice(loadStart).join('\n').trim();

      return {
        leading,
        pretext: pretextBody || null,
        server: '',
      };
    }

    return { leading: '', pretext: null, server: frontmatter.trim() };
  }

  const leading = lines.slice(0, markerIdx).join('\n').trim();
  const afterMarker = lines.slice(markerIdx + 1).join('\n');
  const serverMatch = afterMarker.match(/^\s*\/\/\s*nexus:server\s*$/m);

  let pretextBody: string;
  let serverBody: string;
  if (!serverMatch || serverMatch.index === undefined) {
    pretextBody = afterMarker.trim();
    serverBody = '';
  } else {
    pretextBody = afterMarker.slice(0, serverMatch.index).trim();
    serverBody = afterMarker.slice(serverMatch.index + serverMatch[0].length).trim();
  }

  return {
    leading,
    pretext: pretextBody || null,
    server: serverBody,
  };
}

/**
 * Renames `load` → `nxPretext` so the server can `import { nxPretext }` uniformly.
 */
export function transformPretextExport(pretextBody: string): string {
  let t = pretextBody.trim();
  t = t.replace(/^export\s+async\s+function\s+load\s*\(/u, 'export async function nxPretext(');
  t = t.replace(/^export\s+const\s+load\s*=\s*async\s*/u, 'export const nxPretext = async ');
  t = t.replace(/^export\s+default\s+async\s+function\s+/u, 'export async function nxPretext ');
  return t;
}
