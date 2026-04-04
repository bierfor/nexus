import fs from 'node:fs';
import { join } from 'node:path';

import type { SecurityReportCheck, SecurityReportPayload } from '@nexus_js/server';

type ConfigSlice = { security?: { hardened?: boolean } };

/** Written by `nexus build` to `.nexus/last-build-security.json`. */
interface LastBuildSecuritySnapshot {
  at?: string;
  islandSecurityWarnings?: number;
  auditScanRan?: boolean;
  auditOk?: boolean;
  auditVulnerableCount?: number;
  hardened?: boolean;
  failOnIslandSecurity?: boolean;
}

function loadLastBuildSnapshot(root: string | undefined): LastBuildSecuritySnapshot | null {
  if (!root) return null;
  try {
    const p = join(root, '.nexus', 'last-build-security.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as LastBuildSecuritySnapshot;
  } catch {
    return null;
  }
}

function snapshotHint(at: string | undefined): string {
  if (!at) return '';
  try {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    return ` · last build ${d.toISOString().slice(0, 19)}Z`;
  } catch {
    return '';
  }
}

/**
 * Builds the Studio "Security Report" snapshot from `nexus.config` (best-effort;
 * some rows document roadmap items — not all are enforced at runtime yet).
 *
 * When `root` is set, reads `.nexus/last-build-security.json` from the last `nexus build`
 * to populate compiler-island and audit-build rows.
 */
export function buildSecurityReport(cfg: ConfigSlice, root?: string): SecurityReportPayload {
  const hardened = cfg.security?.hardened === true;
  const snap = loadLastBuildSnapshot(root);
  const hint = snapshotHint(snap?.at);

  let compilerIsland: SecurityReportCheck;
  if (!snap) {
    compilerIsland = {
      id:     'compiler-island',
      label:  'Compiler: island script scan (no build snapshot — run `nexus build`)',
      status: 'info',
    };
  } else if ((snap.islandSecurityWarnings ?? 0) > 0) {
    compilerIsland = {
      id:     'compiler-island',
      label:  `Compiler: ${snap.islandSecurityWarnings} [security] finding(s) in last build${hint}`,
      status: 'warn',
    };
  } else {
    compilerIsland = {
      id:     'compiler-island',
      label:  `Compiler: island script scan clean in last build${hint}`,
      status: 'pass',
    };
  }

  let auditBuild: SecurityReportCheck;
  if (!snap) {
    auditBuild = {
      id:     'audit-build',
      label:  'Dependency audit (no build snapshot — run `nexus build`)',
      status: 'info',
    };
  } else if (!snap.auditScanRan) {
    auditBuild = {
      id:     'audit-build',
      label:  `Dependency audit was not run in last build${hint}`,
      status: 'info',
    };
  } else if (snap.auditOk) {
    auditBuild = {
      id:     'audit-build',
      label:  `Dependency audit: no high/critical findings in last build${hint}`,
      status: 'pass',
    };
  } else {
    const n = snap.auditVulnerableCount ?? 0;
    auditBuild = {
      id:     'audit-build',
      label:  `Dependency audit: ${n} package(s) with findings in last build${hint}`,
      status: 'warn',
    };
  }

  return {
    hardened,
    checks: [
      { id: 'serialize-wire', label: 'Serialize: JSON `<` escaped for script embedding', status: 'pass' },
      { id: 'serialize-html', label: 'Serialize: sanitize() / sanitizeDeep for HTML text', status: 'pass' },
      { ...compilerIsland },
      {
        id:         'hardened-headers',
        label:      'Hardened Mode: baseline HTTP security headers',
        status:     hardened ? 'pass' : 'warn',
      },
      { ...auditBuild },
      { id: 'actions-origin', label: 'Server Actions: CSRF / origin validation (see server)', status: 'info' },
      { id: 'devradar-redact', label: 'DevRadar: telemetry redaction for secret-like keys', status: 'pass' },
      { id: 'hmr-dev-only', label: 'Dev HMR / style bridge: must not ship in production bundle', status: 'info' },
      { id: 'csp-compile', label: 'Compiler-generated CSP hashes (roadmap)', status: 'info' },
      { id: 'action-tokens', label: 'Per-route action tokens (roadmap)', status: 'info' },
      { id: 'tainted-runes', label: 'Tainted rune observability (roadmap)', status: 'info' },
      { id: 'pretext-guard', label: 'Strict pretext wire types / prototype pollution guard (roadmap)', status: 'info' },
    ],
  };
}
