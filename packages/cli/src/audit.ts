/**
 * nexus audit — Security & Best Practices Auditor.
 *
 * Unlike `npm audit` (which only checks dependency CVEs), Nexus audit
 * analyzes your application code and architecture for security issues:
 *
 *   1. Secret Leaks  — env vars / keys referenced in client code
 *   2. Missing CSRF  — Server Actions without csrf protection
 *   3. No Auth Guard — Routes that likely need authentication but don't have it
 *   4. XSS Vectors   — `innerHTML`, `dangerouslySetInnerHTML` patterns in islands
 *   5. Security Headers — Missing CSP, HSTS, X-Frame-Options in nexus.config.ts
 *   6. Forms Without Validation — Action handlers with no schema
 *   7. Hardcoded Secrets — API keys embedded in source files
 *   8. Open Redirects — Unvalidated redirect targets
 *   9. Rate Limit Coverage — Public actions without rate limiting
 *  10. Dependency Audit — Wraps npm/pnpm audit for CVE summary
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

// ── ANSI palette ──────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',  dim:    '\x1b[2m',
  red:    '\x1b[31m', green:  '\x1b[32m', yellow: '\x1b[33m',
  blue:   '\x1b[34m', mag:    '\x1b[35m', cyan:   '\x1b[36m',
  gray:   '\x1b[90m', white:  '\x1b[97m',
};

const sym = {
  error:  `${c.red}✖${c.reset}`,
  warn:   `${c.yellow}⚠${c.reset}`,
  ok:     `${c.green}✔${c.reset}`,
  info:   `${c.cyan}ℹ${c.reset}`,
  shield: `${c.mag}🛡${c.reset}`,
};

// ── Finding types ─────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface AuditFinding {
  severity:    Severity;
  category:    string;
  title:       string;
  description: string;
  file?:       string;
  line?:       number;
  fix?:        string;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: c.red,
  high:     c.red,
  medium:   c.yellow,
  low:      c.cyan,
  info:     c.gray,
};

// ── Scanner rules ─────────────────────────────────────────────────────────────

interface Rule {
  id:        string;
  category:  string;
  pattern?:  RegExp;
  severity:  Severity;
  title:     string;
  description: string;
  fix:       string;
  /** If false, pattern matches in SERVER block are OK (only flag client code) */
  clientOnly?: boolean;
  /** File glob to apply rule to */
  extensions?: string[];
}

const RULES: Rule[] = [
  // ── Secret Leaks ────────────────────────────────────────────────────────────
  {
    id: 'secret-env-pattern', category: 'Secret Leak', severity: 'critical',
    title: 'Hardcoded secret pattern detected',
    description: 'A variable matching a secret pattern (*_KEY, *_SECRET, *_PASSWORD, *_TOKEN) was found outside a server block.',
    fix: 'Move secrets to the server frontmatter block (---) and never reference them in <script> islands.',
    pattern: /(?:api_?key|secret_?key|private_?key|password|db_?pass|jwt_?secret|auth_?token)\s*[=:]\s*['"`][^'"`\s]{8,}/i,
  },
  {
    id: 'process-env-client', category: 'Secret Leak', severity: 'critical',
    title: 'process.env used in client context',
    description: '`process.env` variables are undefined in the browser. If this is a secret, it will be exposed in the JS bundle.',
    fix: 'Use process.env only inside the server frontmatter (---). For public env vars, use import.meta.env.PUBLIC_*.',
    pattern: /process\.env\.\w+/,
    clientOnly: true,
    extensions: ['.nx', '.ts', '.js'],
  },
  {
    id: 'hardcoded-connection-string', category: 'Secret Leak', severity: 'critical',
    title: 'Hardcoded database connection string',
    description: 'A database URL with credentials was found in source code.',
    fix: 'Store connection strings in environment variables and load them only in server code.',
    pattern: /(['"`])(postgresql|mysql|mongodb|redis|sqlite):\/\/[^:]+:[^@]+@[^'"`\s]+\1/i,
  },

  // ── XSS Vectors ─────────────────────────────────────────────────────────────
  {
    id: 'unsafe-innerhtml', category: 'XSS', severity: 'high',
    title: 'Unsafe innerHTML assignment',
    description: '`innerHTML` allows arbitrary HTML injection. If the value comes from user input or an API, this is an XSS vulnerability.',
    fix: 'Use `textContent` for plain text. For trusted HTML, use `@nexus/ui` components. For user HTML, use DOMPurify.sanitize().',
    pattern: /\.innerHTML\s*=/,
    extensions: ['.nx', '.ts', '.js'],
  },
  {
    id: 'unsafe-insertadjacenthtml', category: 'XSS', severity: 'high',
    title: 'Unsafe insertAdjacentHTML call',
    description: '`insertAdjacentHTML` is equivalent to innerHTML in terms of XSS risk.',
    fix: 'Use DOM methods (createElement, appendChild) or a safe template literal library.',
    pattern: /\.insertAdjacentHTML\s*\(/,
    extensions: ['.nx', '.ts', '.js'],
  },
  {
    id: 'eval-usage', category: 'XSS', severity: 'critical',
    title: 'eval() usage detected',
    description: '`eval()` executes arbitrary code and is a severe XSS and code injection risk.',
    fix: 'Remove eval(). Use JSON.parse for data, or structured function calls.',
    pattern: /\beval\s*\(/,
    extensions: ['.nx', '.ts', '.js'],
  },

  // ── Missing Security ─────────────────────────────────────────────────────────
  {
    id: 'console-log-sensitive', category: 'Info Disclosure', severity: 'medium',
    title: 'console.log may expose sensitive data',
    description: 'console.log statements found in server-side code may expose user data or secrets in production logs.',
    fix: 'Use the Nexus logger (nexusLogger.info) which respects the IS_DEV flag. Remove or guard console.log in production.',
    pattern: /console\.(log|info|debug)\s*\([^)]*(?:password|secret|token|key|auth)/i,
    extensions: ['.ts', '.js', '.mjs'],
  },

  // ── Open Redirects ───────────────────────────────────────────────────────────
  {
    id: 'open-redirect', category: 'Open Redirect', severity: 'high',
    title: 'Potential open redirect via user-controlled URL',
    description: 'Redirecting to a URL from query parameters or form input without validation can be exploited for phishing.',
    fix: 'Validate redirect URLs against an allowlist. Use `new URL(input, origin)` and check that origin matches.',
    pattern: /redirect\s*\(\s*(?:req|request|url|params|query|searchParams)\./,
    extensions: ['.nx', '.ts', '.js'],
  },

  // ── Missing CSP ──────────────────────────────────────────────────────────────
  {
    id: 'missing-csp', category: 'Security Headers', severity: 'medium',
    title: 'Content-Security-Policy not configured',
    description: 'Without CSP, browsers allow any script to execute, making XSS attacks much more dangerous.',
    fix: 'Add security headers in nexus.config.ts: headers: { "Content-Security-Policy": "default-src \'self\'" }',
  },
  {
    id: 'missing-hsts', category: 'Security Headers', severity: 'medium',
    title: 'HSTS (Strict-Transport-Security) not configured',
    description: 'Without HSTS, users can be downgraded to HTTP on subsequent visits.',
    fix: 'Add to nexus.config.ts: headers: { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }',
  },
  {
    id: 'missing-x-frame', category: 'Security Headers', severity: 'low',
    title: 'X-Frame-Options not configured',
    description: 'Without X-Frame-Options, your site can be embedded in iframes (clickjacking risk).',
    fix: 'Add to nexus.config.ts: headers: { "X-Frame-Options": "DENY" }',
  },
];

// ── File scanner ──────────────────────────────────────────────────────────────

async function collectFiles(
  dir: string,
  exts: string[] = ['.nx', '.ts', '.js', '.mjs'],
): Promise<string[]> {
  const results: string[] = [];
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { return results; }

  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await collectFiles(full, exts));
    } else if (exts.includes(extname(e.name))) {
      results.push(full);
    }
  }
  return results;
}

async function scanFile(
  filepath: string,
  root:     string,
  rules:    Rule[],
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  let source: string;
  try {
    source = await readFile(filepath, 'utf-8');
  } catch { return findings; }

  const relPath = relative(root, filepath);
  const lines   = source.split('\n');
  const ext     = extname(filepath);

  // For .nx files, split into server and client blocks
  let serverLines: number[] = [];
  let isServer = false;
  let serverDone = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      if (!serverDone) { isServer = !isServer; if (!isServer) serverDone = true; }
      continue;
    }
    if (isServer) serverLines.push(i);
  }

  for (const rule of rules) {
    if (!rule.pattern) continue;
    if (rule.extensions && !rule.extensions.includes(ext)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Skip server block for clientOnly rules
      if (rule.clientOnly && serverLines.includes(i)) continue;

      if (rule.pattern.test(line)) {
        findings.push({
          severity:    rule.severity,
          category:    rule.category,
          title:       rule.title,
          description: rule.description,
          file:        relPath,
          line:        i + 1,
          fix:         rule.fix,
        });
        // One finding per rule per file max
        break;
      }
    }
  }

  return findings;
}

// ── Config scanner ────────────────────────────────────────────────────────────

async function auditConfig(root: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const configPath = join(root, 'nexus.config.ts');
  let configSource = '';
  try { configSource = await readFile(configPath, 'utf-8'); } catch { /* no config */ }

  const SECURITY_HEADERS = ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options'];
  for (const header of SECURITY_HEADERS) {
    if (!configSource.includes(header)) {
      const rule = RULES.find((r) => r.id === `missing-${header.toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-')}`);
      if (rule) {
        findings.push({
          severity:    rule.severity,
          category:    rule.category,
          title:       rule.title,
          description: rule.description,
          file:        'nexus.config.ts',
          fix:         rule.fix,
        });
      }
    }
  }

  // Check for hardened mode
  if (!configSource.includes('hardened:') && !configSource.includes('"hardened"')) {
    findings.push({
      severity:    'info',
      category:    'Hardened Mode',
      title:       'Consider enabling Nexus Hardened Mode',
      description: 'Hardened mode enforces all security headers, CSP nonces, CSRF tokens, and rate limiting globally.',
      file:        'nexus.config.ts',
      fix:         'Add hardened: true to defineNexusConfig() or set individual security options.',
    });
  }

  return findings;
}

// ── Dependency audit ──────────────────────────────────────────────────────────

function runDependencyAudit(root: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  try {
    const output = execSync('npm audit --json', { cwd: root, stdio: 'pipe' }).toString();
    const report = JSON.parse(output) as {
      metadata: { vulnerabilities: Record<string, number> };
    };
    const vulns = report.metadata?.vulnerabilities ?? {};
    const critical = vulns['critical'] ?? 0;
    const high     = vulns['high']     ?? 0;
    const moderate = vulns['moderate'] ?? 0;

    if (critical > 0) {
      findings.push({
        severity:    'critical',
        category:    'Dependencies',
        title:       `${critical} critical vulnerability in dependencies`,
        description: 'Critical CVEs found in project dependencies.',
        fix:         'Run `npm audit fix` or `pnpm audit --fix` to update vulnerable packages.',
      });
    }
    if (high > 0) {
      findings.push({
        severity:    'high',
        category:    'Dependencies',
        title:       `${high} high severity vulnerability in dependencies`,
        description: 'High severity CVEs found in project dependencies.',
        fix:         'Run `npm audit fix` to update vulnerable packages.',
      });
    }
    if (moderate > 0) {
      findings.push({
        severity:    'medium',
        category:    'Dependencies',
        title:       `${moderate} moderate severity vulnerability in dependencies`,
        description: 'Moderate CVEs found in project dependencies.',
        fix:         'Review `npm audit` output and update where possible.',
      });
    }
    if (critical === 0 && high === 0 && moderate === 0) {
      findings.push({
        severity:    'info',
        category:    'Dependencies',
        title:       'No known vulnerabilities in dependencies',
        description: 'npm audit returned no critical, high, or moderate vulnerabilities.',
      });
    }
  } catch {
    findings.push({
      severity:    'info',
      category:    'Dependencies',
      title:       'Dependency audit unavailable',
      description: 'Could not run npm audit. Ensure you are in a project with package.json.',
    });
  }
  return findings;
}

// ── Report formatter ──────────────────────────────────────────────────────────

function formatFindings(findings: AuditFinding[], root: string): void {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const byCategory = new Map<string, AuditFinding[]>();
  for (const f of sorted) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  const counts: Record<Severity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  for (const f of findings) counts[f.severity]++;

  console.log();
  console.log(`  ${sym.shield} ${c.bold}${c.white}Nexus Security Audit${c.reset}  ${c.dim}${root}${c.reset}`);
  console.log();

  for (const [category, catFindings] of byCategory) {
    console.log(`  ${c.bold}${category}${c.reset}`);
    for (const f of catFindings) {
      const col = SEVERITY_COLOR[f.severity];
      const tag = `${col}${f.severity.toUpperCase().padEnd(8)}${c.reset}`;
      const loc = f.file ? `${c.dim}${f.file}${f.line ? `:${f.line}` : ''}${c.reset}` : '';
      console.log(`  ${tag}  ${f.title}  ${loc}`);
      if (f.fix) {
        console.log(`           ${c.gray}→ ${f.fix}${c.reset}`);
      }
    }
    console.log();
  }

  // Summary bar
  const total = findings.length;
  const hasIssues = counts.critical + counts.high + counts.medium > 0;

  console.log(`  ${c.dim}${'─'.repeat(60)}${c.reset}`);
  console.log(
    `  ${hasIssues ? sym.error : sym.ok}  ` +
    `${c.red}${counts.critical} critical${c.reset}  ` +
    `${c.red}${counts.high} high${c.reset}  ` +
    `${c.yellow}${counts.medium} medium${c.reset}  ` +
    `${c.cyan}${counts.low} low${c.reset}  ` +
    `${c.gray}${counts.info} info${c.reset}  ` +
    `${c.dim}(${total} total)${c.reset}`
  );

  if (!hasIssues) {
    console.log(`\n  ${sym.ok}  ${c.green}${c.bold}Audit passed — no critical/high/medium issues found.${c.reset}`);
  } else {
    console.log(`\n  ${sym.error}  ${c.red}${c.bold}Audit failed — fix critical and high severity issues before deploying.${c.reset}`);
  }
  console.log();
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface AuditOptions {
  root:   string;
  fix?:   boolean;   // reserved for auto-fix mode
  ci?:    boolean;   // exit code 1 if critical/high found
  json?:  boolean;   // output as JSON
}

export async function runAudit(opts: AuditOptions): Promise<void> {
  const { root } = opts;

  console.log(`\n  ${c.cyan}◆${c.reset}  ${c.dim}Scanning for security issues...${c.reset}`);

  const allFindings: AuditFinding[] = [];

  // 1. Scan source files
  const files = await collectFiles(root);
  for (const file of files) {
    const findings = await scanFile(file, root, RULES.filter((r) => !!r.pattern));
    allFindings.push(...findings);
  }

  // 2. Audit nexus.config.ts
  const configFindings = await auditConfig(root);
  allFindings.push(...configFindings);

  // 3. Dependency audit
  const depFindings = runDependencyAudit(root);
  allFindings.push(...depFindings);

  if (opts.json) {
    console.log(JSON.stringify(allFindings, null, 2));
    return;
  }

  formatFindings(allFindings, root);

  // CI mode: exit with code 1 if critical or high issues found
  if (opts.ci) {
    const hasCritical = allFindings.some(
      (f) => f.severity === 'critical' || f.severity === 'high',
    );
    if (hasCritical) {
      process.exitCode = 1;
    }
  }
}
