/**
 * When the template is wrapped in <nexus-island>, SSR still stringifies the inner HTML.
 * Runes ($state/$derived) and client handlers are not available on the server — emit safe stubs.
 */

/** Pull `name` from `let name = $state(` / `$derived(` / `$effect(` (best-effort). */
export function listRuneBindingNames(script: string): string[] {
  const names: string[] = [];
  const re = /(?:let|const)\s+(\w+)\s*=\s*\$(?:state|derived|effect)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    const n = m[1];
    if (n) names.push(n);
  }
  return names;
}

function balancedFrom(openParenIdx: number, s: string): number | null {
  let depth = 1;
  for (let i = openParenIdx + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * Extract `let x = $state( INITIAL );` initializers (handles generic `$state<T>(` and nested parens).
 */
export function extractDollarStateInitializers(script: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\b(?:let|const)\s+(\w+)\s*=\s*\$state(?:<[^>]+>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    const name = m[1];
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = balancedFrom(open, script);
    if (!name || close === null) continue;
    const inner = script.slice(open + 1, close).trim();
    map.set(name, inner);
  }
  return map;
}

export function extractDollarDerivedBodies(script: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\b(?:let|const)\s+(\w+)\s*=\s*\$derived\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    const name = m[1];
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = balancedFrom(open, script);
    if (!name || close === null) continue;
    map.set(name, script.slice(open + 1, close).trim());
  }
  return map;
}

/**
 * `function foo` / `async function foo` anywhere in the script (best-effort).
 * Previously only the slice before the first `$effect` was scanned, which missed handlers
 * declared after reactive blocks (e.g. `onSearchInput` after several `$effect`s).
 */
export function listTopLevelFunctions(script: string): { name: string; async: boolean }[] {
  const out: { name: string; async: boolean }[] = [];
  const re = /\b(async\s+)?function\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    out.push({ name: m[2] ?? 'fn', async: Boolean(m[1]) });
  }
  return out;
}

/**
 * Lines to prepend inside `async function renderTemplate(ctx)` before `return \`...\``.
 */
export function islandSsrStubLines(script: string): string[] {
  const lines: string[] = [];
  const stateInits = extractDollarStateInitializers(script);
  const derivedBodies = extractDollarDerivedBodies(script);
  const runeNames = new Set(listRuneBindingNames(script));

  for (const fn of listTopLevelFunctions(script)) {
    const rhs = fn.async ? 'async () => {}' : '() => {}';
    lines.push(`  const ${fn.name} = ${rhs};`);
  }

  for (const [name, init] of stateInits) {
    lines.push(`  const ${name} = (${init});`);
  }

  for (const [name, body] of derivedBodies) {
    const expr = body.replace(/,\s*$/u, '').trim();
    lines.push(`  const ${name} = (${expr});`);
  }

  for (const name of runeNames) {
    if (stateInits.has(name)) continue;
    if (derivedBodies.has(name)) continue;
    if (lines.some((l) => l.includes(` const ${name} = `))) continue;
    lines.push(`  const ${name} = [];`);
  }

  return lines;
}
