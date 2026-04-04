/**
 * Splits `.nx` server frontmatter into optional `// nexus:pretext` … `// nexus:server` regions.
 *
 * ```
 * ---
 * import { db } from '$lib/db';
 * // nexus:pretext
 * export async function load(ctx) {
 *   return { flow: await db.flows.findFirst() };
 * }
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
