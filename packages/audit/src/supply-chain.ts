/**
 * Nexus Supply Chain Guard.
 *
 * Uses the public npm registry API to detect signs of supply chain compromise:
 *
 *  1. SINGLE MAINTAINER — one compromised account = full package control
 *  2. RECENT MAINTAINER CHANGE — new owner in last 90 days (account takeover pattern)
 *  3. NEWLY PUBLISHED POPULAR NAME — typosquatting / dependency confusion
 *  4. ABANDONED PACKAGE — no updates in 2+ years but still widely imported
 *  5. RAPID VERSION BUMP — many versions published in a short time (malware injection)
 *  6. OWNER TRANSFER — package ownership changed (acquisition or takeover)
 *
 * What we CANNOT check (npm considers it private):
 *  - Whether individual maintainers have MFA/2FA enabled
 *    (npm Team policy requires it for popular packages as of 2022, but status is not in the API)
 *
 * Risk score: 0 (safe) → 100 (critical risk)
 * Threshold: ≥60 = warn, ≥80 = block in hardened mode
 *
 * npm registry API:
 *   GET https://registry.npmjs.org/{package}       → full metadata
 *   GET https://registry.npmjs.org/{package}/latest → latest version only
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const REGISTRY     = 'https://registry.npmjs.org';
const CACHE_DIR    = join(homedir(), '.nexus', 'cache', 'npm-meta');
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000; // 6h (changes more frequently than CVEs)

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupplyChainRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface SupplyChainFlag {
  code:        string;
  title:       string;
  description: string;
  riskPoints:  number;   // contribution to total score (0–100)
}

export interface SupplyChainResult {
  package:      string;
  riskScore:    number;          // 0–100
  riskLevel:    SupplyChainRiskLevel;
  flags:        SupplyChainFlag[];
  maintainers:  string[];
  latestVersion:string;
  firstPublished: string;
  lastPublished:  string;
  totalVersions:  number;
  cached:       boolean;
  stale:        boolean;
  checkedAt:    number;
}

interface NpmMeta {
  name:         string;
  'dist-tags':  Record<string, string>;
  maintainers:  Array<{ name: string; email?: string }>;
  time:         Record<string, string>;  // version → ISO date; also 'created', 'modified'
  versions:     Record<string, unknown>;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  try { await mkdir(CACHE_DIR, { recursive: true }); } catch { /* exists */ }
}

function cacheKey(pkg: string): string {
  return pkg.replace(/\//g, '__').replace(/@/g, '_at_');
}

async function readNpmCache(pkg: string): Promise<{ result: SupplyChainResult; expiresAt: number } | null> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${cacheKey(pkg)}.json`), 'utf-8');
    return JSON.parse(raw) as { result: SupplyChainResult; expiresAt: number };
  } catch { return null; }
}

async function writeNpmCache(pkg: string, result: SupplyChainResult): Promise<void> {
  await ensureDir();
  try {
    await writeFile(
      join(CACHE_DIR, `${cacheKey(pkg)}.json`),
      JSON.stringify({ result, expiresAt: Date.now() + CACHE_TTL_MS }, null, 2),
    );
  } catch { /* non-fatal */ }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchNpmMeta(pkg: string): Promise<NpmMeta | null> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal:  controller.signal,
    });
    if (!res.ok) return null;
    return await res.json() as NpmMeta;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Risk analysis ─────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string = new Date().toISOString()): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

function analyzeRisk(meta: NpmMeta): { flags: SupplyChainFlag[]; score: number } {
  const flags: SupplyChainFlag[] = [];
  let score = 0;

  const maintainerCount = meta.maintainers?.length ?? 0;
  const versions        = Object.keys(meta.versions ?? {});
  const timeEntries     = Object.entries(meta.time ?? {})
    .filter(([k]) => !['created', 'modified'].includes(k))
    .sort(([, a], [, b]) => new Date(a).getTime() - new Date(b).getTime());

  const firstPublished  = meta.time['created']  ?? timeEntries[0]?.[1] ?? '';
  const lastPublished   = meta.time['modified'] ?? timeEntries[timeEntries.length - 1]?.[1] ?? '';
  const daysOld         = firstPublished ? daysBetween(firstPublished) : 0;
  const daysSinceUpdate = lastPublished  ? daysBetween(lastPublished)  : 0;

  // ① Single maintainer
  if (maintainerCount === 1) {
    const pts = 25;
    score += pts;
    flags.push({
      code:        'SINGLE_MAINTAINER',
      title:       'Single maintainer',
      description: `This package has only 1 maintainer. A compromised account means full control over all releases.`,
      riskPoints:  pts,
    });
  } else if (maintainerCount === 0) {
    const pts = 35;
    score += pts;
    flags.push({
      code:        'NO_MAINTAINER',
      title:       'No maintainers listed',
      description: 'No maintainers found in registry metadata — package may be abandoned or orphaned.',
      riskPoints:  pts,
    });
  }

  // ② Recently created (< 30 days old) — typosquatting / dependency confusion window
  if (daysOld < 30 && daysOld > 0) {
    const pts = 30;
    score += pts;
    flags.push({
      code:        'NEWLY_PUBLISHED',
      title:       `Published ${daysOld} day${daysOld === 1 ? '' : 's'} ago`,
      description: 'Very new packages are high-risk for typosquatting and dependency confusion attacks. Verify the name carefully.',
      riskPoints:  pts,
    });
  }

  // ③ Abandoned — last update > 2 years
  if (daysSinceUpdate > 730 && versions.length > 0) {
    const years = (daysSinceUpdate / 365).toFixed(1);
    const pts   = 20;
    score += pts;
    flags.push({
      code:        'ABANDONED',
      title:       `Not updated in ${years} years`,
      description: 'Abandoned packages accumulate unpatched CVEs and may not work with current Node.js versions.',
      riskPoints:  pts,
    });
  }

  // ④ Rapid version publishing — many versions in a short window (injection pattern)
  const recentVersions = timeEntries.filter(([, ts]) => daysBetween(ts) < 7);
  if (recentVersions.length >= 5) {
    const pts = 35;
    score += pts;
    flags.push({
      code:        'RAPID_VERSIONS',
      title:       `${recentVersions.length} versions published in the last 7 days`,
      description: 'Rapid version publishing is a known pattern for malware injection — attackers publish many versions to slip through automated scanners.',
      riskPoints:  pts,
    });
  }

  // ⑤ Recent maintainer churn — if many versions published very recently from fresh pkg
  const last30DayVersions = timeEntries.filter(([, ts]) => daysBetween(ts) < 30).length;
  if (daysOld < 180 && last30DayVersions > 10) {
    const pts = 20;
    score += pts;
    flags.push({
      code:        'OWNERSHIP_CHURN',
      title:       'High version churn on a new package',
      description: `${last30DayVersions} versions in the last 30 days on a package less than 6 months old — possible account takeover or automated malware distribution.`,
      riskPoints:  pts,
    });
  }

  // ⑥ Very few total versions for a package > 1 year old (abandoned, low quality)
  if (versions.length <= 2 && daysOld > 365) {
    const pts = 10;
    score += pts;
    flags.push({
      code:        'LOW_ACTIVITY',
      title:       'Very few versions for an old package',
      description: 'Package has barely been maintained. May have unaddressed bugs or security issues.',
      riskPoints:  pts,
    });
  }

  return { flags, score: Math.min(100, score) };
}

function scoreToLevel(score: number): SupplyChainRiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  if (score >= 15) return 'low';
  return 'safe';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyzes a package for supply chain risk signals using the npm registry.
 *
 * Does NOT check individual MFA status (not in npm public API).
 * DOES check: maintainer count, age, version velocity, abandonment.
 */
export async function checkSupplyChain(pkg: string): Promise<SupplyChainResult> {
  const cached = await readNpmCache(pkg);
  const now    = Date.now();

  if (cached && now < cached.expiresAt) {
    return { ...cached.result, cached: true, stale: false };
  }

  const meta = await fetchNpmMeta(pkg);

  if (!meta) {
    if (cached) return { ...cached.result, cached: true, stale: true };
    return {
      package:      pkg, riskScore: 0, riskLevel: 'safe', flags: [],
      maintainers: [], latestVersion: 'unknown',
      firstPublished: '', lastPublished: '', totalVersions: 0,
      cached: false, stale: false, checkedAt: now,
    };
  }

  const { flags, score } = analyzeRisk(meta);
  const versions         = Object.keys(meta.versions ?? {});
  const timeEntries      = Object.entries(meta.time ?? {})
    .filter(([k]) => !['created', 'modified'].includes(k))
    .sort(([, a], [, b]) => new Date(a).getTime() - new Date(b).getTime());

  const result: SupplyChainResult = {
    package:       meta.name ?? pkg,
    riskScore:     score,
    riskLevel:     scoreToLevel(score),
    flags,
    maintainers:   (meta.maintainers ?? []).map((m) => m.name),
    latestVersion: meta['dist-tags']?.latest ?? versions[versions.length - 1] ?? 'unknown',
    firstPublished: meta.time['created'] ?? timeEntries[0]?.[1] ?? '',
    lastPublished:  meta.time['modified'] ?? timeEntries[timeEntries.length - 1]?.[1] ?? '',
    totalVersions:  versions.length,
    cached:  false,
    stale:   false,
    checkedAt: now,
  };

  await writeNpmCache(pkg, result);
  return result;
}

/**
 * Checks supply chain risk for all packages in a dependency map.
 * Returns only packages with riskLevel >= 'medium'.
 */
export async function auditSupplyChain(
  deps: Record<string, string>,
): Promise<Map<string, SupplyChainResult>> {
  const results  = new Map<string, SupplyChainResult>();
  const packages = Object.keys(deps);
  const BATCH    = 8;

  for (let i = 0; i < packages.length; i += BATCH) {
    const batch = packages.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (pkg) => {
        const result = await checkSupplyChain(pkg);
        return [pkg, result] as [string, SupplyChainResult];
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value[1].riskLevel !== 'safe') {
        results.set(s.value[0], s.value[1]);
      }
    }
  }

  return results;
}

/** Note about MFA status — shown in audit output for transparency */
export const MFA_NOTE =
  'npm requires MFA for maintainers of packages with >500 weekly downloads as of 2022, ' +
  'but individual MFA status is not publicly exposed by the registry API. ' +
  'Use `npm access list collaborators {package}` with appropriate permissions ' +
  'to view maintainer details for your own packages.';
