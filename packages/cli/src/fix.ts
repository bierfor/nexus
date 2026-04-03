/**
 * nexus fix — Automatic Vulnerability Remediation.
 *
 * Reads package.json, queries OSV for vulnerable packages,
 * finds the patched version for each, updates package.json,
 * runs the package manager install, and re-runs audit to verify.
 *
 * Unlike `npm audit fix` which is coarse-grained, `nexus fix`:
 *  - Only updates SPECIFICALLY the vulnerable package (not all transitive deps)
 *  - Targets the MINIMUM patched version (not always latest)
 *  - Respects your semver range preferences (^x.y.z → ^x.y.fix)
 *  - Shows a before/after diff
 *  - Offers a --dry-run mode (no changes written)
 *  - Re-audits after fixing to confirm 0 critical CVEs remain
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join }                from 'node:path';
import { execSync }            from 'node:child_process';

// ── ANSI ──────────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m', bold:  '\x1b[1m', dim:  '\x1b[2m',
  red:    '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan:   '\x1b[36m', mag:   '\x1b[35m', gray:   '\x1b[90m',
};

const log = {
  ok:    (...a: unknown[]) => console.log(`  \x1b[32m✔\x1b[0m`, ...a),
  warn:  (...a: unknown[]) => console.log(`  \x1b[33m⚠\x1b[0m`, ...a),
  error: (...a: unknown[]) => console.error(`  \x1b[31m✖\x1b[0m`, ...a),
  info:  (...a: unknown[]) => console.log(`  \x1b[36mℹ\x1b[0m`, ...a),
  step:  (...a: unknown[]) => console.log(`  \x1b[35m◆\x1b[0m`, ...a),
};

// ── Package manager detection ─────────────────────────────────────────────────

function detectPackageManager(root: string): 'pnpm' | 'npm' | 'yarn' {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  if (existsSync(join(root, 'pnpm-lock.yaml')))    return 'pnpm';
  if (existsSync(join(root, 'yarn.lock')))          return 'yarn';
  return 'npm';
}

function installCmd(pm: string, pkg: string, version: string): string {
  const spec = `${pkg}@${version}`;
  if (pm === 'pnpm') return `pnpm add ${spec}`;
  if (pm === 'yarn') return `yarn add ${spec}`;
  return `npm install ${spec}`;
}

// ── Semver helpers ────────────────────────────────────────────────────────────

function preserveRange(oldRange: string, newVersion: string): string {
  const prefix = oldRange.match(/^([~^>=<]+)/)?.[1] ?? '';
  // If old range used ^, preserve it so minor updates still work
  if (prefix === '^') return `^${newVersion}`;
  if (prefix === '~') return `~${newVersion}`;
  return newVersion;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export interface FixOptions {
  root:    string;
  dryRun?: boolean;
  force?:  boolean;  // fix even medium/low severity
}

export async function runFix(opts: FixOptions): Promise<void> {
  const { root, dryRun = false } = opts;

  console.log();
  log.step(`${c.bold}Nexus Fix${c.reset}  ${c.dim}—${c.reset} automatic vulnerability remediation`);
  if (dryRun) log.warn('Dry run mode — no changes will be written');
  console.log();

  // Load audit engine (dynamic — gracefully fails if not installed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  try {
    audit = await import('@nexus/audit');
  } catch {
    log.error('@nexus/audit not installed. Run: pnpm add -D @nexus/audit');
    process.exitCode = 1;
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auditDependencies: (deps: Record<string, string>) => Promise<Map<string, any>>
    = audit.auditDependencies;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterVulnerable: (r: Map<string, any>) => any[] = audit.filterVulnerable;

  // Read package.json
  const pkgPath = join(root, 'package.json');
  let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8')) as typeof pkgJson;
  } catch {
    log.error(`Cannot read ${pkgPath}`);
    process.exitCode = 1;
    return;
  }

  const deps    = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const isDev   = new Set(Object.keys(pkgJson.devDependencies ?? {}));

  log.info(`Scanning ${Object.keys(deps).length} packages via OSV...`);
  const results   = await auditDependencies(deps);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vulnerable = filterVulnerable(results).filter((r: any) =>
    !opts.force ? (r.vulns[0]?.severity === 'critical' || r.vulns[0]?.severity === 'high') : true,
  );

  if (vulnerable.length === 0) {
    log.ok('No critical/high vulnerabilities found — nothing to fix!');
    console.log();
    return;
  }

  console.log(`  Found ${c.red}${vulnerable.length}${c.reset} vulnerable package${vulnerable.length > 1 ? 's' : ''}:\n`);

  // Collect fix actions
  const fixes: Array<{ pkg: string; oldVersion: string; newVersion: string; cve: string; isDev: boolean }> = [];
  const noFix: Array<{ pkg: string; cve: string; reason: string }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const result of vulnerable as any[]) {
    const topVuln = result.vulns[0];
    if (!topVuln) continue;

    const currentRange = (deps as Record<string, string>)[result.package as string] ?? '*';
    const fixedIn      = topVuln.fixedIn as string | undefined;

    console.log(
      `  ${c.bold}${result.package}${c.reset}  ${c.dim}(current: ${currentRange})${c.reset}\n` +
      `    ${topVuln.id}  ${topVuln.severity.toUpperCase()}  ${topVuln.summary}`
    );

    if (fixedIn) {
      const newRange = preserveRange(currentRange, fixedIn);
      console.log(`    ${c.green}→ Update to v${fixedIn}${c.reset}  (range: ${newRange})\n`);
      fixes.push({
        pkg:        result.package,
        oldVersion: currentRange,
        newVersion: newRange,
        cve:        topVuln.id,
        isDev:      isDev.has(result.package),
      });
    } else {
      console.log(`    ${c.yellow}→ No patched version available in OSV data${c.reset}`);
      console.log(`    Consider: replacing, removing, or adding an allowVulnerable override\n`);
      noFix.push({
        pkg:    result.package,
        cve:    topVuln.id,
        reason: 'No patched version in OSV database',
      });
    }
  }

  if (fixes.length === 0) {
    log.warn('No automatic fixes available. Review the packages above manually.');
    console.log();
    return;
  }

  if (dryRun) {
    console.log(`  ${c.dim}─────────────────────────────────────${c.reset}`);
    console.log(`  ${c.cyan}Dry run — would apply ${fixes.length} fix${fixes.length > 1 ? 'es' : ''}:${c.reset}`);
    for (const f of fixes) {
      console.log(`    ${f.pkg}: ${f.oldVersion} → ${f.newVersion}`);
    }
    console.log();
    return;
  }

  // Apply fixes to package.json
  const pm = detectPackageManager(root);
  let applied = 0;

  for (const fix of fixes) {
    log.step(`Updating ${c.bold}${fix.pkg}${c.reset} ${fix.oldVersion} → ${c.green}${fix.newVersion}${c.reset}`);

    try {
      const cmd = installCmd(pm, fix.pkg, fix.newVersion.replace(/^[\^~]/, ''));
      execSync(cmd, { cwd: root, stdio: 'inherit' });
      applied++;
      log.ok(`${fix.pkg} updated`);
    } catch {
      log.error(`Failed to update ${fix.pkg}. Try manually: ${pm} add ${fix.pkg}@${fix.newVersion}`);
    }
  }

  console.log();

  // Re-audit to verify
  if (applied > 0) {
    log.step('Re-auditing after fixes...');
    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as typeof pkgJson;
    const updatedDeps = { ...updatedPkg.dependencies, ...updatedPkg.devDependencies };
    const reCheck = await auditDependencies(updatedDeps as Record<string, string>);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stillVulnerable = filterVulnerable(reCheck).filter((r: any) =>
      r.vulns[0]?.severity === 'critical' || r.vulns[0]?.severity === 'high',
    );

    if (stillVulnerable.length === 0) {
      log.ok(`${c.green}${c.bold}All critical/high vulnerabilities resolved!${c.reset}`);
    } else {
      log.warn(`${stillVulnerable.length} vulnerability/vulnerabilities remain:`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of stillVulnerable as any[]) {
        const v = r.vulns[0];
        if (v) log.error(`  ${r.package} — ${v.id} (${v.severity})`);
      }
      log.info('Run `nexus audit` for full details. Some may require manual intervention.');
    }
  }

  if (noFix.length > 0) {
    console.log();
    log.warn(`${noFix.length} package${noFix.length > 1 ? 's have' : ' has'} no automatic fix:`);
    for (const n of noFix) {
      console.log(`  ${c.yellow}${n.pkg}${c.reset}  ${n.cve}  — ${n.reason}`);
    }
    log.info('Consider adding an allowVulnerable override in nexus.config.ts with an expiry date.');
  }

  console.log();
}
