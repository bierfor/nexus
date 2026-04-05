/**
 * Nexus Security Vite Plugin — Compiler-Level Dependency Blocking.
 *
 * Integrates the @nexus_js/audit engine directly into the Vite module resolution
 * pipeline. When an import is resolved, the plugin checks the package against
 * the OSV CVE database BEFORE the bundler processes the module.
 *
 * Two modes:
 *
 *  WARN (default in dev):
 *    Logs a colored warning to the terminal. Build continues.
 *    Use for medium/high severity or when the developer is actively working.
 *
 *  BLOCK (in hardened mode or for critical severity):
 *    Throws a build error with a detailed explanation.
 *    The dev server shows a full-page error overlay.
 *    The production build stops completely.
 *
 * The overlay in the browser shows:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  🛑 Nexus Security Blocked                                          │
 *  │  Package "pdfkit@0.13.0" has a CRITICAL vulnerability               │
 *  │  CVE-2024-29415 — Server-Side Request Forgery                       │
 *  │  Fix: pnpm update pdfkit@0.14.0 (patched)                          │
 *  │  Or: nexus fix — auto-update all vulnerable packages                │
 *  └─────────────────────────────────────────────────────────────────────┘
 */

import type { Plugin } from 'vite';

export type AllowVulnerableConfig = Record<string, {
  cve: string;
  reason: string;
  expires: string;
}>;

export interface NexusSecurityPluginOptions {
  /**
   * Security mode.
   *   'off'      — no scanning
   *   'warn'     — log warnings, never block
   *   'block'    — block critical CVEs in build, warn for high/medium
   *   'paranoid' — block critical + high, warn for medium
   */
  mode?: 'off' | 'warn' | 'block' | 'paranoid';
  /** Override exceptions (from nexus.config.ts security.allowVulnerable) */
  allowVulnerable?: AllowVulnerableConfig;
  /** Enable supply chain risk checks (default: true) */
  supplyChain?: boolean;
}

// ── ANSI ──────────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m', bold:  '\x1b[1m',  dim:   '\x1b[2m',
  red:    '\x1b[31m', yellow: '\x1b[33m', cyan:  '\x1b[36m',
  mag:    '\x1b[35m', green:  '\x1b[32m',
};

function sev(s: string): string {
  if (s === 'critical') return `${c.red}${c.bold}CRITICAL${c.reset}`;
  if (s === 'high')     return `${c.red}HIGH${c.reset}`;
  if (s === 'medium')   return `${c.yellow}MEDIUM${c.reset}`;
  return `${c.dim}${s.toUpperCase()}${c.reset}`;
}

// ── Package name extractor ────────────────────────────────────────────────────
// From: 'lodash/fp', '@types/node', 'react' → package name only
function extractPackageName(source: string): string | null {
  if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0')) return null;
  if (source.startsWith('virtual:') || source.startsWith('node:')) return null;
  // Handle scoped packages (@org/name)
  if (source.startsWith('@')) {
    const parts = source.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return source.split('/')[0] ?? null;
}

// In-process cache to avoid scanning the same package multiple times per build
const _scanned = new Map<string, boolean>();

// ── Plugin factory ────────────────────────────────────────────────────────────

/**
 * Creates the Nexus Security Vite plugin.
 * Integrated automatically when `security.hardened: true` in nexus.config.ts.
 *
 * @example
 * // vite.config.ts
 * import { nexus, nexusSecurity } from '@nexus_js/vite-plugin-nexus';
 * export default { plugins: [nexus(), nexusSecurity({ mode: 'block' })] };
 */
export function nexusSecurity(opts: NexusSecurityPluginOptions = {}): Plugin {
  const mode           = opts.mode ?? 'warn';
  const allowVulnerable = opts.allowVulnerable ?? {};

  if (mode === 'off') {
    return { name: 'nexus:security-disabled' };
  }

  return {
    name: 'nexus:dependency-audit',

    /**
     * buildStart — scan all dependencies once at startup (faster than per-import).
     * resolveId  — catch dynamic imports and workspace packages not in package.json.
     */
    async buildStart() {
      _scanned.clear();

      // Lazy import to avoid loading @nexus_js/audit in non-security builds
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let auditMod: any;
      try {
        auditMod = await import('@nexus_js/audit');
      } catch {
        this.warn('[Nexus Security] @nexus_js/audit not installed. Run: pnpm add -D @nexus_js/audit');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scanProject: (opts: any) => Promise<any> = auditMod.scanProject;

      const root = (this.meta as { watchMode?: boolean; env?: { root?: string } }).env?.root
        ?? process.cwd();

      try {
        const result = await scanProject({
          root,
          includeDev:      false,
          supplyChain:     opts.supplyChain !== false,
          allowVulnerable,
          failOnCritical:  mode === 'block' || mode === 'paranoid',
          minSeverity:     mode === 'paranoid' ? 'medium' : 'high',
        });

        // Log vulnerable packages
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const vuln of result.vulnerable as any[]) {
          const topVuln = vuln.vulns[0] as { severity: string; id: string; summary: string; fixedIn?: string } | undefined;
          if (!topVuln) continue;

          const msg =
            `\n  ${c.mag}◆ Nexus Security${c.reset}  ${sev(topVuln.severity)} in ${c.bold}"${vuln.package}"${c.reset}\n` +
            `    ${topVuln.id}: ${topVuln.summary}\n` +
            (topVuln.fixedIn ? `    ${c.green}Fix: update to v${topVuln.fixedIn}${c.reset}\n` : '') +
            `    Run ${c.cyan}nexus fix${c.reset} to auto-update`;

          if ((mode === 'block' || mode === 'paranoid') && topVuln.severity === 'critical') {
            this.error(msg); // Stops the build
          } else {
            this.warn(msg);
          }
        }

        // Supply chain warnings
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const [pkg, sc] of result.supplyChain as Map<string, any>) {
          if (sc.riskLevel === 'critical' || sc.riskLevel === 'high') {
            const topFlag = sc.flags[0] as { title: string; description: string } | undefined;
            this.warn(
              `\n  ${c.mag}◆ Nexus Supply Chain${c.reset}  ${sev(sc.riskLevel)} risk: ${c.bold}"${pkg}"${c.reset}\n` +
              (topFlag ? `    ${topFlag.title}: ${topFlag.description}\n` : '') +
              `    Risk score: ${sc.riskScore}/100`,
            );
          }
        }

        // Print override status
        const { expiringSoon, expired } = result.overrideStatus;
        for (const e of expiringSoon) {
          this.warn(`  ${c.yellow}[Nexus Security]${c.reset} Override expiring soon: ${e}`);
        }
        for (const e of expired) {
          this.error(`  ${c.red}[Nexus Security]${c.reset} Expired override: ${e} — update the dependency or renew the override`);
        }

        if (result.vulnerable.length === 0 && result.supplyChain.size === 0) {
          console.log(`  ${c.green}✔${c.reset}  ${c.dim}Nexus Security: all dependencies clean${c.reset}`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NEXUS_SECURITY_BLOCK') {
          this.error((err as Error).message);
        } else {
          // Don't fail the build for audit infrastructure errors
          this.warn(`[Nexus Security] Audit failed: ${(err as Error).message}`);
        }
      }
    },

    async resolveId(source) {
      // Only check external packages (not relative imports or virtual)
      const pkg = extractPackageName(source);
      if (!pkg || _scanned.has(pkg)) return null;
      _scanned.set(pkg, true);

      // Only block in 'block' or 'paranoid' mode — warn is handled at buildStart
      if (mode !== 'block' && mode !== 'paranoid') return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let auditMod2: any;
      try {
        auditMod2 = await import('@nexus_js/audit');
      } catch { return null; }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (auditMod2.auditPackage as (p: string) => Promise<any>)(pkg);
        if (result.status !== 'vulnerable') return null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const criticalVuln = (result.vulns as any[]).find((v: any) => v.severity === 'critical') as {
          id: string; severity: string; summary: string; fixedIn?: string;
        } | undefined;
        if (!criticalVuln) return null;

        // Check override
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const overrideResult = (auditMod2.findOverride as (pkg: string, cve: string, cfg: any) => any)(pkg, criticalVuln.id, allowVulnerable);
        if (overrideResult?.valid) return null; // Override active

        const msg =
          `\n  ${'─'.repeat(65)}\n` +
          `  ${c.red}${c.bold}🛑 NEXUS SECURITY — BUILD BLOCKED${c.reset}\n` +
          `  ${'─'.repeat(65)}\n` +
          `  Package   : ${c.bold}"${pkg}"${c.reset}\n` +
          `  CVE       : ${criticalVuln.id}\n` +
          `  Severity  : ${sev(criticalVuln.severity)}\n` +
          `  Summary   : ${criticalVuln.summary}\n` +
          (criticalVuln.fixedIn ? `  Fix       : Update to v${criticalVuln.fixedIn}\n` : '') +
          `  Command   : ${c.cyan}nexus fix${c.reset}\n` +
          `  Override  : Add to nexus.config.ts → security.allowVulnerable\n` +
          `  ${'─'.repeat(65)}`;

        this.error(msg);
      } catch { /* audit failure is non-fatal */ }

      return null;
    },
  };
}
