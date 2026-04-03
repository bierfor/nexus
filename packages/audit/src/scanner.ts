/**
 * Nexus Package Scanner — reads package.json and coordinates audits.
 *
 * Combines:
 *  - CVE scanning via OSV (engine.ts)
 *  - Supply chain risk via npm registry (supply-chain.ts)
 *  - Override policy validation (override.ts)
 *
 * Entry point for both the CLI and the Vite plugin.
 */

import { readFile } from 'node:fs/promises';
import { join }     from 'node:path';

import { auditDependencies, filterVulnerable, type AuditResult, type VulnSeverity } from './engine.js';
import { auditSupplyChain,  type SupplyChainResult }                                  from './supply-chain.js';
import { findOverride, validateOverride, formatOverrides, type AllowVulnerableConfig } from './override.js';

export type { AuditResult, VulnSeverity, SupplyChainResult, AllowVulnerableConfig };
export { filterVulnerable };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScanOptions {
  root:                 string;
  /** Include devDependencies in the scan (default: false) */
  includeDev?:          boolean;
  /** Supply chain guard (default: true) */
  supplyChain?:         boolean;
  /** Override exceptions from nexus.config.ts security.allowVulnerable */
  allowVulnerable?:     AllowVulnerableConfig;
  /**
   * If true, critical CVEs that are not overridden will throw (for build-time blocking).
   * If false, they are reported but don't throw.
   */
  failOnCritical?:      boolean;
  /** Minimum severity to report (default: 'low') */
  minSeverity?:         VulnSeverity;
}

export interface ScanResult {
  scannedPackages:    number;
  vulnerable:         AuditResult[];
  supplyChain:        Map<string, SupplyChainResult>;
  overrideStatus:     ReturnType<typeof formatOverrides>;
  blockedPackages:    string[];   // packages that would block a build
  durationMs:         number;
}

// ── Main scanner ──────────────────────────────────────────────────────────────

/**
 * Full dependency scan: CVE + supply chain + override validation.
 * This is the core function called by both `nexus audit` and the Vite plugin.
 */
export async function scanProject(opts: ScanOptions): Promise<ScanResult> {
  const t0 = Date.now();

  // Read package.json
  const pkgPath = join(opts.root, 'package.json');
  let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8')) as typeof pkgJson;
  } catch {
    throw new Error(`[Nexus Audit] Cannot read package.json at ${pkgPath}`);
  }

  // Collect deps
  const deps: Record<string, string> = {
    ...pkgJson.dependencies,
    ...(opts.includeDev ? pkgJson.devDependencies : {}),
  };

  const scannedPackages = Object.keys(deps).length;

  // Parallel: CVE scan + supply chain scan
  const [cveResults, scResults] = await Promise.all([
    auditDependencies(deps),
    opts.supplyChain !== false ? auditSupplyChain(deps) : Promise.resolve(new Map<string, SupplyChainResult>()),
  ]);

  const vulnerable = filterVulnerable(cveResults);

  // Override policy validation
  const overrides     = opts.allowVulnerable ?? {};
  const overrideStats = formatOverrides(overrides);
  const blockedPackages: string[] = [];

  const SORDER: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  const minSev = opts.minSeverity ?? 'low';

  for (const result of vulnerable) {
    for (const vuln of result.vulns) {
      if (SORDER[vuln.severity] > SORDER[minSev]) continue;

      if (vuln.severity !== 'critical' && vuln.severity !== 'high') continue;

      // Check if there's a valid override
      const overrideResult = findOverride(result.package, vuln.id, overrides)
        ?? findOverride(result.package, vuln.aliases[0] ?? '', overrides);

      if (overrideResult?.valid) {
        // Override is active — report but don't block
        continue;
      }

      if (!overrideResult || overrideResult.expired) {
        // No override or expired → block
        if (!blockedPackages.includes(result.package)) {
          blockedPackages.push(result.package);
        }
      }
    }
  }

  const scanResult: ScanResult = {
    scannedPackages,
    vulnerable,
    supplyChain: scResults,
    overrideStatus: overrideStats,
    blockedPackages,
    durationMs: Date.now() - t0,
  };

  // Throw for build-time blocking
  if (opts.failOnCritical && blockedPackages.length > 0) {
    const details = blockedPackages
      .map((pkg) => {
        const r = cveResults.get(pkg);
        const topVuln = r?.vulns[0];
        return topVuln
          ? `  "${pkg}" — ${topVuln.id} (${topVuln.severity.toUpperCase()}): ${topVuln.summary}`
          : `  "${pkg}"`;
      })
      .join('\n');

    throw new NexusSecurityError(
      `[Nexus Security] 🛑 BUILD BLOCKED — ${blockedPackages.length} critical/high CVE${blockedPackages.length > 1 ? 's' : ''} detected:\n\n` +
      `${details}\n\n` +
      `Options:\n` +
      `  1. Run \`nexus fix\` to automatically update to patched versions\n` +
      `  2. Add a time-limited override in nexus.config.ts (security.allowVulnerable)\n` +
      `  3. Run \`nexus audit\` for full details and suggested fixes`,
      blockedPackages,
      vulnerable,
    );
  }

  return scanResult;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class NexusSecurityError extends Error {
  constructor(
    message: string,
    public readonly blockedPackages: string[],
    public readonly vulnerable: AuditResult[],
  ) {
    super(message);
    this.name = 'NexusSecurityError';
  }
}

// ── Single-package audit (for Vite plugin import hook) ───────────────────────

export { auditPackage } from './engine.js';
export { checkSupplyChain } from './supply-chain.js';
export { validateOverride, findOverride } from './override.js';
