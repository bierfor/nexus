/**
 * Nexus Shield-lite — build-time manifest (routes + server action names) for request allowlists.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SHIELD_MANIFEST_FILENAME = 'shield-manifest.json';

export interface ShieldManifestV1 {
  version: 1;
  routes: string[];
  actions: string[];
}

export function parseShieldManifest(raw: string): ShieldManifestV1 | null {
  try {
    const o = JSON.parse(raw) as Partial<ShieldManifestV1>;
    if (o.version !== 1) return null;
    if (!Array.isArray(o.routes) || !Array.isArray(o.actions)) return null;
    return {
      version: 1,
      routes: o.routes.filter((x): x is string => typeof x === 'string'),
      actions: o.actions.filter((x): x is string => typeof x === 'string'),
    };
  } catch {
    return null;
  }
}

export function loadShieldManifestFromRoot(appRoot: string): ShieldManifestV1 | null {
  const p = join(appRoot, '.nexus', 'output', SHIELD_MANIFEST_FILENAME);
  try {
    return parseShieldManifest(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Matches registerAction("name", …) in emitted sidecars (JSON.stringify always uses double quotes). */
const RE_REGISTER_ACTION = /registerAction\s*\(\s*"([^"]+)"/g;

export function extractActionNamesFromActionsSource(source: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  RE_REGISTER_ACTION.lastIndex = 0;
  while ((m = RE_REGISTER_ACTION.exec(source)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function collectFilesRecursive(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  function walk(d: string): void {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (match(name)) out.push(p);
    }
  }
  walk(dir);
  return out;
}

/** Scan .nexus/output for *.actions.js files (recursive). */
export function collectActionNamesFromOutputDir(outDir: string): string[] {
  const names = new Set<string>();
  const files = collectFilesRecursive(outDir, (n) => n.endsWith('.actions.js'));
  for (const p of files) {
    try {
      const src = readFileSync(p, 'utf-8');
      for (const n of extractActionNamesFromActionsSource(src)) names.add(n);
    } catch {
      /* skip */
    }
  }
  return [...names].sort();
}
