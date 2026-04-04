/**
 * Nexus Security Override Policy — "Ghost Wall" exceptions.
 *
 * Sometimes a library is vulnerable but:
 *  - The patch isn't yet on a stable release
 *  - You only use the affected function in a build-time context (never in production)
 *  - Your organization has an accepted risk decision documented elsewhere
 *
 * Overrides are explicit, time-limited exceptions that:
 *  1. Require a documented reason
 *  2. Expire automatically — the build fails again after the date
 *  3. Are logged in every audit report
 *  4. Do NOT suppress warnings (only prevent build failure)
 *
 * Usage in nexus.config.ts:
 *
 * ```ts
 * import { defineNexusConfig } from '@nexus_js/core';
 *
 * export default defineNexusConfig({
 *   security: {
 *     hardened: true,
 *     allowVulnerable: {
 *       'pdfkit': {
 *         cve: 'CVE-2024-29415',
 *         reason: 'Used in build-time PDF generation only. Not in the client bundle. ' +
 *                 'Patched version releases 2026-05-15 according to maintainer.',
 *         expires: '2026-06-01',
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * After `expires`, the build fails again, forcing re-evaluation.
 * If the patch is available, update the dependency. If not, extend the override with a new reason.
 */

export interface VulnerabilityOverride {
  /** CVE ID or OSV ID being overridden */
  cve:     string;
  /** REQUIRED: human-readable business justification */
  reason:  string;
  /**
   * ISO date string (YYYY-MM-DD). After this date, the override expires
   * and the build will fail again. Maximum: 180 days from today.
   */
  expires: string;
}

export type AllowVulnerableConfig = Record<string, VulnerabilityOverride>;

export interface OverrideValidation {
  valid:     boolean;
  expired:   boolean;
  daysLeft:  number;
  message:   string;
}

/**
 * Validates an override at build time.
 * Returns { valid: false } if expired or malformed.
 */
export function validateOverride(
  pkg:      string,
  override: VulnerabilityOverride,
): OverrideValidation {
  const expiry = new Date(override.expires);

  if (isNaN(expiry.getTime())) {
    return {
      valid:    false,
      expired:  false,
      daysLeft: 0,
      message:  `[Nexus Security] Override for "${pkg}" has an invalid expiry date: "${override.expires}". Use YYYY-MM-DD format.`,
    };
  }

  const now      = new Date();
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const expired  = daysLeft <= 0;

  if (expired) {
    return {
      valid:    false,
      expired:  true,
      daysLeft: 0,
      message:
        `[Nexus Security] ⛔ Override for "${pkg}" (${override.cve}) EXPIRED on ${override.expires}.\n` +
        `  Original reason: "${override.reason}"\n` +
        `  The vulnerability must now be addressed. Options:\n` +
        `    1. Update "${pkg}" to a patched version\n` +
        `    2. Replace "${pkg}" with a safe alternative\n` +
        `    3. Extend the override with a new expiry date (requires fresh justification)`,
    };
  }

  // Warn when approaching expiry
  const warningDays = 14;
  const warning     = daysLeft <= warningDays
    ? `\n  ⚠️  Override for "${pkg}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${override.expires}).`
    : '';

  return {
    valid:    true,
    expired:  false,
    daysLeft,
    message: `[Nexus Security] ⚠️  OVERRIDE ACTIVE for "${pkg}" (${override.cve}).${warning}\n  Reason: "${override.reason}"`,
  };
}

/**
 * Checks if a package+CVE combination is covered by an active override.
 * Returns null if no override applies (build should fail on critical CVE).
 */
export function findOverride(
  pkg:      string,
  cveId:    string,
  overrides: AllowVulnerableConfig,
): OverrideValidation | null {
  const override = overrides[pkg];
  if (!override) return null;

  // Check if the CVE matches (direct or alias)
  const configCve  = override.cve.toUpperCase().trim();
  const queryCve   = cveId.toUpperCase().trim();

  if (configCve !== queryCve && !queryCve.includes(configCve) && !configCve.includes(queryCve)) {
    return null;
  }

  return validateOverride(pkg, override);
}

/**
 * Formats all active overrides for display in audit output.
 * Groups by status: active, expiring soon, expired.
 */
export function formatOverrides(
  overrides: AllowVulnerableConfig,
): { active: string[]; expiringSoon: string[]; expired: string[] } {
  const active:       string[] = [];
  const expiringSoon: string[] = [];
  const expired:      string[] = [];

  for (const [pkg, override] of Object.entries(overrides)) {
    const v = validateOverride(pkg, override);
    if (v.expired) {
      expired.push(`${pkg} (${override.cve}) — expired ${override.expires}`);
    } else if (v.daysLeft <= 14) {
      expiringSoon.push(`${pkg} (${override.cve}) — expires in ${v.daysLeft} days`);
    } else {
      active.push(`${pkg} (${override.cve}) — ${v.daysLeft} days left`);
    }
  }

  return { active, expiringSoon, expired };
}

/**
 * Returns the maximum safe override duration (180 days from now).
 * Overrides beyond this are rejected to prevent permanent exceptions.
 */
export function maxOverrideDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 180);
  return d.toISOString().split('T')[0] as string;
}
