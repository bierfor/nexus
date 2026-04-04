/**
 * Nexus Bundle Budget Analyzer
 *
 * Generates a detailed visual report of JS payload per route.
 * Runs automatically after `nexus build` or standalone with `nexus analyze`.
 *
 * Terminal output:
 *
 *   ◆ Nexus Bundle Analysis
 *   ════════════════════════════════════════════════════════
 *
 *   Route: /
 *   ┌─────────────────────────────┬────────┬────────┬───────┐
 *   │ Module                      │  Raw   │ Gzip   │ Share │
 *   ├─────────────────────────────┼────────┼────────┼───────┤
 *   │ @nexus_js/runtime (shared)     │  4.2KB │  1.8KB │  ███░ │
 *   │ islands/Counter.client.js   │  1.1KB │  0.5KB │  █░░░ │
 *   │ islands/SearchBar.client.js │  2.8KB │  1.1KB │  ██░░ │
 *   ├─────────────────────────────┼────────┼────────┼───────┤
 *   │ TOTAL                       │  8.1KB │  3.4KB │       │
 *   └─────────────────────────────┴────────┴────────┴───────┘
 *   Budget: ✓ Under 10KB limit
 *
 *   Route: /blog/[slug]  ← OVER BUDGET ⚠
 *   ...
 *
 *   ─── Summary ─────────────────────────────────────────────
 *   Routes analyzed:  12
 *   Under budget:     10
 *   Over budget:       2  ⚠ /dashboard, /checkout
 *   Largest route:    /checkout (48KB gzip)
 *   Zero-JS routes:    4  (/, /about, /blog, /contact)
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BundleModule {
  name: string;
  path: string;
  rawBytes: number;
  gzipBytes: number;
  kind: 'runtime' | 'island' | 'shared' | 'action';
}

export interface RouteBudget {
  route: string;
  modules: BundleModule[];
  totalRaw: number;
  totalGzip: number;
  isZeroJS: boolean;
  overBudget: boolean;
  budgetBytes: number;
}

export interface AnalysisReport {
  routes: RouteBudget[];
  runtimeSize: number;
  generatedAt: string;
  totalIslands: number;
  zeroJSRoutes: number;
  overBudgetRoutes: string[];
}

export interface AnalyzerOptions {
  root: string;
  /** Gzip budget per route in bytes (default: 50KB) */
  budgetBytes?: number;
  /** Show per-module breakdown (default: true) */
  verbose?: boolean;
  /** Output format */
  format?: 'terminal' | 'json' | 'html';
  /** Write report to file */
  outFile?: string;
}

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

// ── Main entry ────────────────────────────────────────────────────────────────

export async function analyzeBundles(opts: AnalyzerOptions): Promise<AnalysisReport> {
  const budgetBytes = opts.budgetBytes ?? 50 * 1024; // 50KB gzip default
  const outDir = join(opts.root, '.nexus', 'output');
  const verbose = opts.verbose ?? true;

  const routes = await collectRouteBudgets(outDir, budgetBytes);
  const runtimeSize = await measureRuntime(outDir);

  const report: AnalysisReport = {
    routes,
    runtimeSize,
    generatedAt: new Date().toISOString(),
    totalIslands: routes.flatMap((r) => r.modules.filter((m) => m.kind === 'island')).length,
    zeroJSRoutes: routes.filter((r) => r.isZeroJS).length,
    overBudgetRoutes: routes.filter((r) => r.overBudget).map((r) => r.route),
  };

  // Output
  if (opts.format === 'json') {
    const json = JSON.stringify(report, null, 2);
    if (opts.outFile) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(opts.outFile, json, 'utf-8');
    } else {
      console.log(json);
    }
  } else {
    printTerminalReport(report, verbose);
  }

  return report;
}

// ── Route budget collection ───────────────────────────────────────────────────

async function collectRouteBudgets(
  outDir: string,
  budgetBytes: number,
): Promise<RouteBudget[]> {
  const routes: RouteBudget[] = [];

  // Read the manifest
  let manifest: { routes: Array<{ pattern: string; filepath: string }> };
  try {
    const raw = await readFile(join(outDir, 'manifest.json'), 'utf-8');
    manifest = JSON.parse(raw);
  } catch {
    return [];
  }

  for (const route of manifest.routes) {
    const modules: BundleModule[] = [];

    // Check for client bundle
    const clientPath = route.filepath.replace(/\.nx$/, '.client.js');
    const clientAbs = join(outDir, clientPath);

    try {
      const info = await stat(clientAbs);
      if (info.isFile()) {
        const content = await readFile(clientAbs);
        modules.push({
          name: relative(outDir, clientAbs),
          path: clientAbs,
          rawBytes: content.length,
          gzipBytes: estimateGzip(content.length),
          kind: 'island',
        });
      }
    } catch {}

    const totalRaw = modules.reduce((s, m) => s + m.rawBytes, 0);
    const totalGzip = modules.reduce((s, m) => s + m.gzipBytes, 0);

    routes.push({
      route: route.pattern,
      modules,
      totalRaw,
      totalGzip,
      isZeroJS: modules.length === 0,
      overBudget: totalGzip > budgetBytes,
      budgetBytes,
    });
  }

  return routes;
}

async function measureRuntime(outDir: string): Promise<number> {
  try {
    const runtimePath = join(outDir, 'runtime.js');
    const info = await stat(runtimePath);
    return estimateGzip(info.size);
  } catch {
    return 0; // Runtime not found — report 0
  }
}

// ── Terminal renderer ─────────────────────────────────────────────────────────

function printTerminalReport(report: AnalysisReport, verbose: boolean): void {
  const width = 66;
  const line = '═'.repeat(width);
  const thin = '─'.repeat(width);

  console.log('');
  console.log(`  ${C.cyan}${C.bold}◆ Nexus Bundle Analysis${C.reset}`);
  console.log(`  ${C.dim}${line}${C.reset}`);
  console.log('');

  // Runtime overhead
  if (report.runtimeSize > 0) {
    console.log(
      `  ${C.dim}Shared Runtime${C.reset}  ${fmtSize(report.runtimeSize)} gzip  ${C.dim}(amortized across all routes)${C.reset}`,
    );
    console.log('');
  }

  for (const route of report.routes) {
    const statusIcon = route.isZeroJS
      ? `${C.green}◉ 0 JS${C.reset}`
      : route.overBudget
        ? `${C.red}⚠ OVER BUDGET${C.reset}`
        : `${C.green}✓${C.reset}`;

    console.log(`  ${C.bold}Route: ${route.route}${C.reset}  ${statusIcon}`);

    if (route.isZeroJS) {
      console.log(`    ${C.dim}No JavaScript sent to client — pure HTML${C.reset}`);
      console.log('');
      continue;
    }

    if (verbose && route.modules.length > 0) {
      // Table header
      console.log(`    ${C.dim}┌${'─'.repeat(32)}┬────────┬────────┬──────────┐${C.reset}`);
      console.log(`    ${C.dim}│${C.reset} ${pad('Module', 30)} ${C.dim}│${C.reset}  ${C.dim}Raw   ${C.reset}${C.dim}│${C.reset}  ${C.dim}Gzip  ${C.reset}${C.dim}│${C.reset}  Budget   ${C.dim}│${C.reset}`);
      console.log(`    ${C.dim}├${'─'.repeat(32)}┼────────┼────────┼──────────┤${C.reset}`);

      for (const mod of route.modules) {
        const share = Math.min(1, mod.gzipBytes / route.budgetBytes);
        const bar = buildBar(share, 8);
        const name = truncate(mod.name, 30);
        const kindBadge = kindColor(mod.kind);
        console.log(
          `    ${C.dim}│${C.reset} ${kindBadge}${pad(name, 30)}${C.reset} ${C.dim}│${C.reset} ${pad(fmtSize(mod.rawBytes), 6)} ${C.dim}│${C.reset} ${pad(fmtSize(mod.gzipBytes), 6)} ${C.dim}│${C.reset} ${bar} ${C.dim}│${C.reset}`,
        );
      }

      console.log(`    ${C.dim}├${'─'.repeat(32)}┼────────┼────────┼──────────┤${C.reset}`);
      const totalColor = route.overBudget ? C.red : C.green;
      console.log(
        `    ${C.dim}│${C.reset} ${C.bold}${pad('TOTAL', 30)}${C.reset} ${C.dim}│${C.reset} ${pad(fmtSize(route.totalRaw), 6)} ${C.dim}│${C.reset} ${totalColor}${pad(fmtSize(route.totalGzip), 6)}${C.reset} ${C.dim}│${C.reset} ${buildBudgetBar(route)} ${C.dim}│${C.reset}`,
      );
      console.log(`    ${C.dim}└${'─'.repeat(32)}┴────────┴────────┴──────────┘${C.reset}`);
    } else {
      const totalColor = route.overBudget ? C.red : C.green;
      console.log(`    JS: ${fmtSize(route.totalRaw)} raw  ${totalColor}${fmtSize(route.totalGzip)} gzip${C.reset}  (${route.modules.length} island${route.modules.length !== 1 ? 's' : ''})`);
    }

    if (route.overBudget) {
      const excess = fmtSize(route.totalGzip - route.budgetBytes);
      console.log(`    ${C.red}Budget exceeded by ${excess}. Consider: client:visible, code-splitting, or reducing island scope.${C.reset}`);
    }
    console.log('');
  }

  // Summary
  console.log(`  ${C.dim}${thin}${C.reset}`);
  console.log(`  ${C.bold}Summary${C.reset}`);
  console.log(`    Routes analyzed:  ${report.routes.length}`);
  console.log(`    ${C.green}Zero-JS routes:   ${report.zeroJSRoutes}${C.reset}`);
  console.log(`    Total islands:    ${report.totalIslands}`);

  if (report.overBudgetRoutes.length > 0) {
    console.log(`    ${C.red}Over budget:      ${report.overBudgetRoutes.length}${C.reset}`);
    for (const r of report.overBudgetRoutes) {
      console.log(`      ${C.dim}↳ ${r}${C.reset}`);
    }
  } else {
    console.log(`    ${C.green}All routes within budget ✓${C.reset}`);
  }
  console.log('');
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  return s.length > n ? '…' + s.slice(-(n - 1)) : s;
}

function buildBar(share: number, width: number): string {
  const filled = Math.round(share * width);
  const empty = width - filled;
  return `${C.cyan}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset}`;
}

function buildBudgetBar(route: RouteBudget): string {
  const share = Math.min(1, route.totalGzip / route.budgetBytes);
  const width = 8;
  const filled = Math.round(share * width);
  const empty = width - filled;
  const color = route.overBudget ? C.red : C.green;
  return `${color}${'█'.repeat(Math.min(filled, width))}${C.dim}${'░'.repeat(Math.max(0, empty))}${C.reset}`;
}

function kindColor(kind: BundleModule['kind']): string {
  switch (kind) {
    case 'runtime': return C.cyan;
    case 'island':  return C.green;
    case 'shared':  return C.yellow;
    case 'action':  return '\x1b[35m';
    default: return '';
  }
}

/** Estimate gzip size: typically ~40% of raw for JS */
function estimateGzip(rawBytes: number): number {
  return Math.round(rawBytes * 0.4);
}
