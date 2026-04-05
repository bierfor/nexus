/**
 * Production build identifier — written by `nexus build` to `.nexus/build-id.json`.
 * Server and browser must agree on this value so stale tabs can be rejected with 412.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null | undefined;

/**
 * Reads `.nexus/build-id.json` once and caches the result.
 * Returns `null` if the file is missing (dev without prior build, or legacy deploy).
 */
export function loadAndCacheNexusBuildId(appRoot: string): string | null {
  if (cached !== undefined) return cached;
  const p = join(appRoot, '.nexus', 'build-id.json');
  try {
    if (!existsSync(p)) {
      cached = null;
      return null;
    }
    const raw = readFileSync(p, 'utf-8');
    const j   = JSON.parse(raw) as { buildId?: string };
    const id  = j.buildId;
    cached =
      typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Cached build id after {@link loadAndCacheNexusBuildId}; `null` if none loaded. */
export function getExpectedNexusBuildId(): string | null {
  return cached ?? null;
}

/** Test hook */
export function resetNexusBuildIdCache(): void {
  cached = undefined;
}
