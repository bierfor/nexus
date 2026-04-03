/**
 * Nexus Guard — Compiler-level security leak detector.
 *
 * Analyzes .nx files to ensure server-only values (environment variables,
 * DB connection strings, API secrets, private keys) never reach the client
 * bundle. The guard runs at build time AND in dev mode on every file change.
 *
 * Architecture:
 *   .nx file
 *     ├── Server block (between --- delimiters) — safe to use secrets
 *     └── Template section
 *           ├── Static HTML — never executed by client
 *           └── <script> blocks — compiled into client bundle ← DANGER ZONE
 *
 * The guard checks if variables holding secret values are referenced inside
 * <script> blocks that will be included in the client bundle.
 */

export type LeakType =
  | 'env-secret'       // process.env.DATABASE_PASSWORD etc.
  | 'env-var'          // any process.env.* in client code
  | 'db-connection'    // postgresql:// mongodb:// etc.
  | 'api-key'          // Stripe sk_live_, AWS keys, etc.
  | 'private-key';     // PEM private keys

export type Severity = 'error' | 'warning';

export interface SecurityLeak {
  type:     LeakType;
  variable: string;
  line:     number;
  column:   number;
  severity: Severity;
  message:  string;
  /** Actionable fix suggestion */
  hint:     string;
}

export interface GuardResult {
  filepath:  string;
  passed:    boolean;
  leaks:     SecurityLeak[];
  /** Lines scanned */
  scanned:   number;
  /** ms taken to run the guard */
  duration:  number;
}

// ── Secret patterns ────────────────────────────────────────────────────────────
// Order matters: more specific patterns first.

interface Pattern {
  regex:    RegExp;
  type:     LeakType;
  severity: Severity;
  hint:     string;
}

const PATTERNS: Pattern[] = [
  {
    // PEM private keys
    regex:    /-----BEGIN\s+[\w\s]+PRIVATE KEY-----/gi,
    type:     'private-key',
    severity: 'error',
    hint:     'Private keys must never appear in source files. Use a secrets manager or environment variable.',
  },
  {
    // Stripe, Clerk, Supabase secret keys
    regex:    /\b(sk_live_|sk_test_|supabase_secret_|clerk_secret_|AKID)[A-Za-z0-9_-]{10,}/g,
    type:     'api-key',
    severity: 'error',
    hint:     'Hard-coded API keys are a critical security risk. Store in process.env and reference server-side only.',
  },
  {
    // Database connection strings
    regex:    /(['"`])(postgresql|mysql|mongodb|redis|sqlite):\/\/[^'"`\s]+\1/gi,
    type:     'db-connection',
    severity: 'error',
    hint:     'Database URLs contain credentials. Use process.env.DATABASE_URL in the server block only.',
  },
  {
    // High-risk env vars (secrets by name)
    regex:    /process\.env\.(\w*(?:PASSWORD|SECRET|PRIVATE|KEY|TOKEN|CERT|SEED|SALT|CREDENTIALS)\w*)/gi,
    type:     'env-secret',
    severity: 'error',
    hint:     'This env var appears to contain a secret. Access it only in the server frontmatter (--- block).',
  },
  {
    // Any other process.env.* reference in client code
    regex:    /process\.env\.([A-Z_][A-Z0-9_]+)/g,
    type:     'env-var',
    severity: 'warning',
    hint:     'process.env is not available in the browser. Move this to the server frontmatter or use $env() from @nexus/runtime.',
  },
];

// ── Parser helpers ─────────────────────────────────────────────────────────────

/** Extract the server frontmatter block (between --- delimiters). */
function extractServerBlock(source: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return match?.[1] ?? '';
}

/** Extract all client-facing <script> blocks from the template section. */
function extractClientScripts(source: string): Array<{ content: string; startLine: number }> {
  // Remove frontmatter first
  const template = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const frontmatterLines = source.length - template.length > 0
    ? source.slice(0, source.indexOf(template)).split('\n').length
    : 0;

  const results: Array<{ content: string; startLine: number }> = [];
  const scriptRe = /<script(?:\s[^>]*)?>(?!\s*\/\/)?([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRe.exec(template)) !== null) {
    const before = template.slice(0, match.index);
    const startLine = frontmatterLines + before.split('\n').length;
    results.push({ content: match[1] ?? '', startLine });
  }

  return results;
}

/** Scan a code block for a pattern, returning all match locations. */
function scanBlock(
  content: string,
  startLine: number,
  pattern: Pattern,
): Array<{ variable: string; line: number; column: number }> {
  const results: Array<{ variable: string; line: number; column: number }> = [];
  const lines = content.split('\n');
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');

  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(lines[i] ?? '')) !== null) {
      results.push({
        variable: m[1] != null ? `${m[0].split('(')[0]}.${m[1]}` : m[0].slice(0, 60),
        line:     startLine + i,
        column:   m.index,
      });
    }
  }

  return results;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Analyzes a .nx file for security leaks.
 *
 * @param source   - Raw .nx file content
 * @param filepath - Path to the file (for error messages)
 * @returns GuardResult with all detected leaks
 *
 * @example
 * import { guard } from '@nexus/compiler/guard';
 * const result = guard(source, 'src/routes/+page.nx');
 * if (!result.passed) {
 *   for (const leak of result.leaks.filter(l => l.severity === 'error')) {
 *     console.error(`[Guard] ${leak.message} (line ${leak.line})`);
 *   }
 *   process.exit(1);
 * }
 */
export function guard(source: string, filepath: string): GuardResult {
  const t0 = Date.now();
  const leaks: SecurityLeak[] = [];

  const serverBlock   = extractServerBlock(source);
  const clientScripts = extractClientScripts(source);

  // ── Step 1: Find secret variable names defined in the server block ─────────
  const serverSecrets = new Map<string, { type: LeakType; severity: Severity }>();

  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(serverBlock)) !== null) {
      // Look backwards for a variable assignment: const apiKey = process.env.API_KEY
      const beforeMatch = serverBlock.slice(0, m.index);
      const assignMatch = /(?:const|let|var)\s+(\w+)\s*=\s*$/.exec(beforeMatch.trimEnd());
      if (assignMatch?.[1]) {
        serverSecrets.set(assignMatch[1], { type: pattern.type, severity: pattern.severity });
      }
    }
  }

  // ── Step 2: Scan client scripts for secret variable references ─────────────
  for (const { content, startLine } of clientScripts) {
    // Check if any server-assigned secret variable is used here
    for (const [varName, info] of serverSecrets) {
      const varRe = new RegExp(`\\b${varName}\\b`, 'g');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const col = (lines[i] ?? '').search(varRe);
        if (col !== -1) {
          leaks.push({
            type:     info.type,
            variable: varName,
            line:     startLine + i,
            column:   col,
            severity: 'error',
            message:  `Secret "${varName}" defined in server block may leak to client bundle`,
            hint:     `Pass only sanitized values to island props. Never forward server secrets as component attributes.`,
          });
        }
      }
    }

    // Check for direct secret patterns in client code
    for (const pattern of PATTERNS) {
      const found = scanBlock(content, startLine, pattern);
      for (const f of found) {
        // Skip if already caught by step 1
        if (!leaks.some((l) => l.line === f.line && l.variable === f.variable)) {
          leaks.push({
            type:     pattern.type,
            variable: f.variable,
            line:     f.line,
            column:   f.column,
            severity: pattern.severity,
            message:  `${pattern.type === 'env-var' ? 'process.env' : 'Secret pattern'} "${f.variable}" in client-facing script`,
            hint:     pattern.hint,
          });
        }
      }
    }
  }

  // Deduplicate by line+variable
  const seen = new Set<string>();
  const unique = leaks.filter((l) => {
    const key = `${l.line}:${l.variable}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    filepath,
    passed:   unique.filter((l) => l.severity === 'error').length === 0,
    leaks:    unique,
    scanned:  source.split('\n').length,
    duration: Date.now() - t0,
  };
}

/** Format a GuardResult for terminal output with ANSI colors. */
export function formatGuardResult(result: GuardResult): string {
  const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m',
  };

  if (result.passed && result.leaks.length === 0) {
    return `  ${c.green}🛡️  Guard${c.reset}  ${result.filepath}  ${c.dim}${result.scanned} lines — no leaks found${c.reset}`;
  }

  const lines: string[] = [
    `  ${c.red}🛡️  Guard${c.reset}  ${result.filepath}  ${c.dim}${result.scanned} lines${c.reset}`,
  ];

  for (const leak of result.leaks) {
    const sCol = leak.severity === 'error' ? c.red : c.yellow;
    lines.push(
      `\n  ${sCol}${leak.severity.toUpperCase().padEnd(7)}${c.reset}` +
      `  line ${leak.line}  ${c.bold}"${leak.variable}"${c.reset}` +
      `\n  ${c.dim}${leak.message}${c.reset}` +
      `\n  ${c.cyan}Hint: ${leak.hint}${c.reset}`,
    );
  }

  return lines.join('\n');
}
