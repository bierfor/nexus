/**
 * Nexus Audit Engine — CVE Database via OSV (Open Source Vulnerabilities).
 *
 * Uses the free, open Google OSV API (https://osv.dev) — no API key required.
 * Responses are cached locally in ~/.nexus/cache/ for offline operation.
 *
 * API reference: https://google.github.io/osv.dev/api/
 *
 * Cache strategy:
 *  - Queries are cached per package@version for 24h (TTL configurable)
 *  - On offline: stale cache is used transparently (no error)
 *  - Cache location: ~/.nexus/cache/osv/{pkg-name}.json
 *
 * OSV severity mapping to Nexus levels:
 *   CRITICAL → critical  (CVSS ≥ 9.0 or explicit CRITICAL)
 *   HIGH     → high      (CVSS 7.0–8.9)
 *   MEDIUM   → medium    (CVSS 4.0–6.9)
 *   LOW      → low       (CVSS < 4.0)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OSV_API      = 'https://api.osv.dev/v1/query';
const CACHE_DIR    = join(homedir(), '.nexus', 'cache', 'osv');
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000; // 24h

// ── Types ─────────────────────────────────────────────────────────────────────

export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface Vulnerability {
  id:               string;        // e.g. 'GHSA-29mw-wpgm-hmr9' or 'CVE-2024-1234'
  summary:          string;
  severity:         VulnSeverity;
  cvss?:            number | undefined;   // CVSS v3 base score
  aliases:          string[];             // CVE IDs and other aliases
  affectedVersions: string;              // human-readable range
  fixedIn?:         string | undefined;   // first patched version
  references:       string[];            // advisory URLs
  published:        string;              // ISO date
}

export interface AuditResult {
  package:     string;
  version:     string;
  status:      'safe' | 'vulnerable' | 'unknown';
  vulns:       Vulnerability[];
  /** True if result came from local cache */
  cached:      boolean;
  /** True if result is stale (TTL expired) but used because offline */
  stale:       boolean;
  checkedAt:   number;
}

interface CacheEntry {
  result:    AuditResult;
  expiresAt: number;
  version:   string;
}

interface OsvResponse {
  vulns?: OsvVuln[];
}

interface OsvVuln {
  id:         string;
  summary?:   string;
  aliases?:   string[];
  published:  string;
  references?: Array<{ url: string }>;
  severity?:  Array<{ type: string; score: string }>;
  affected?:  Array<{
    package?:  { name: string; ecosystem: string };
    ranges?:   Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
    versions?: string[];
  }>;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function ensureCacheDir(): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
  } catch { /* already exists */ }
}

function cacheKey(pkg: string): string {
  return pkg.replace(/\//g, '__').replace(/@/g, '_at_');
}

async function readCache(pkg: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${cacheKey(pkg)}.json`), 'utf-8');
    return JSON.parse(raw) as CacheEntry;
  } catch { return null; }
}

async function writeCache(pkg: string, entry: CacheEntry): Promise<void> {
  await ensureCacheDir();
  try {
    await writeFile(join(CACHE_DIR, `${cacheKey(pkg)}.json`), JSON.stringify(entry, null, 2));
  } catch { /* cache write failure is non-fatal */ }
}

// ── OSV API ───────────────────────────────────────────────────────────────────

function parseSeverity(vuln: OsvVuln): { severity: VulnSeverity; cvss?: number } {
  const severityBlock = vuln.severity ?? [];

  // Look for CVSS v3 score first
  for (const s of severityBlock) {
    if (s.type === 'CVSS_V3' || s.type === 'CVSS_V4') {
      // Extract numeric score from vector string (e.g. "CVSS:3.1/AV:N/AC:L/...")
      // OSV also sometimes provides the numeric score directly
      const scoreMatch = s.score.match(/^(\d+\.\d+)$/) ??
                         s.score.match(/\/(\d+\.\d+)$/);
      const score = scoreMatch ? parseFloat(scoreMatch[1] ?? '0') : 0;
      let sev: VulnSeverity = 'unknown';
      if (score >= 9.0) sev = 'critical';
      else if (score >= 7.0) sev = 'high';
      else if (score >= 4.0) sev = 'medium';
      else if (score > 0)    sev = 'low';
      return { severity: sev, cvss: score };
    }
  }

  // Fall back to explicit severity labels in the ID
  const id = vuln.id.toUpperCase();
  if (id.includes('CRITICAL')) return { severity: 'critical' };
  if (id.includes('HIGH'))     return { severity: 'high' };
  if (id.includes('MEDIUM'))   return { severity: 'medium' };
  if (id.includes('LOW'))      return { severity: 'low' };
  return { severity: 'unknown' };
}

function parseFixedVersion(vuln: OsvVuln): string | undefined {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return undefined;
}

function parseAffectedVersions(vuln: OsvVuln): string {
  const parts: string[] = [];
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      let intro: string | undefined;
      let fixed: string | undefined;
      for (const event of range.events ?? []) {
        if (event.introduced) intro = event.introduced;
        if (event.fixed)      fixed = event.fixed;
      }
      if (intro && fixed)   parts.push(`>=${intro} <${fixed}`);
      else if (intro)       parts.push(`>=${intro}`);
      else if (fixed)       parts.push(`<${fixed}`);
    }
    // Direct version list
    if (affected.versions?.length) {
      parts.push(affected.versions.slice(0, 5).join(', ') + (affected.versions.length > 5 ? '...' : ''));
    }
  }
  return parts.join('; ') || 'all versions';
}

async function fetchFromOSV(pkg: string, version?: string): Promise<OsvResponse | null> {
  const body: Record<string, unknown> = {
    package: { name: pkg, ecosystem: 'npm' },
  };
  if (version) body['version'] = version;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(OSV_API, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    if (!res.ok) return null;
    return await res.json() as OsvResponse;
  } catch {
    return null; // network error — caller falls back to cache
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Audits a single package for known CVEs using the OSV database.
 * Results are cached locally for 24h.
 *
 * @param pkg      Package name (e.g. 'lodash' or '@angular/core')
 * @param version  Specific version to check (e.g. '4.17.20'). If omitted, checks all versions.
 */
export async function auditPackage(pkg: string, version?: string): Promise<AuditResult> {
  const cached = await readCache(pkg);
  const now    = Date.now();

  // Fresh cache hit
  if (cached && now < cached.expiresAt) {
    return { ...cached.result, cached: true, stale: false };
  }

  // Try to fetch from OSV
  const osvData = await fetchFromOSV(pkg, version);

  if (!osvData) {
    // Offline or API error — use stale cache if available
    if (cached) {
      return { ...cached.result, cached: true, stale: true };
    }
    // No cache at all
    return {
      package: pkg, version: version ?? '*',
      status: 'unknown', vulns: [],
      cached: false, stale: false,
      checkedAt: now,
    };
  }

  // Parse OSV response
  const vulns: Vulnerability[] = (osvData.vulns ?? []).map((v) => {
    const { severity, cvss } = parseSeverity(v);
    return {
      id:               v.id,
      summary:          v.summary ?? 'No summary available',
      severity,
      cvss,
      aliases:          v.aliases ?? [],
      affectedVersions: parseAffectedVersions(v),
      fixedIn:          parseFixedVersion(v),
      references:       (v.references ?? []).map((r) => r.url),
      published:        v.published,
    };
  });

  // Sort by severity
  const SORDER: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  vulns.sort((a, b) => SORDER[a.severity] - SORDER[b.severity]);

  const result: AuditResult = {
    package:   pkg,
    version:   version ?? '*',
    status:    vulns.length > 0 ? 'vulnerable' : 'safe',
    vulns,
    cached:    false,
    stale:     false,
    checkedAt: now,
  };

  await writeCache(pkg, { result, expiresAt: now + CACHE_TTL_MS, version: version ?? '*' });
  return result;
}

/**
 * Audits all dependencies in a package.json.
 * Runs queries in parallel (max 6 concurrent) to avoid rate limiting.
 */
export async function auditDependencies(
  deps: Record<string, string>,
): Promise<Map<string, AuditResult>> {
  const results = new Map<string, AuditResult>();
  const entries = Object.entries(deps);
  const BATCH   = 6;

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async ([name, versionRange]) => {
        // Strip semver range prefix for OSV query
        const version = versionRange.replace(/^[\^~>=<]/, '').split(' ')[0];
        const result  = await auditPackage(name, version);
        return [name, result] as [string, AuditResult];
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        results.set(s.value[0], s.value[1]);
      }
    }
  }

  return results;
}

/** Returns only vulnerable packages, sorted by severity. */
export function filterVulnerable(results: Map<string, AuditResult>): AuditResult[] {
  const SORDER: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  return [...results.values()]
    .filter((r) => r.status === 'vulnerable')
    .sort((a, b) => {
      const as = a.vulns[0]?.severity ?? 'unknown';
      const bs = b.vulns[0]?.severity ?? 'unknown';
      return SORDER[as] - SORDER[bs];
    });
}

/** Invalidates the local cache for a specific package (forces re-fetch). */
export async function invalidateCache(pkg: string): Promise<void> {
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(join(CACHE_DIR, `${cacheKey(pkg)}.json`));
  } catch { /* file may not exist */ }
}

/** Clears the entire OSV cache (all packages). */
export async function clearCache(): Promise<void> {
  const { rm } = await import('node:fs/promises');
  try {
    await rm(CACHE_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
}
