#!/usr/bin/env node
/**
 * Nexus CLI — nexus dev | nexus build | nexus start | nexus check | nexus studio | nexus audit
 */

import { parseArgs } from 'node:util';
import { STUDIO_DEFAULT_PORT } from '@nexus_js/server/constants';

// ── ANSI palette (shared across all CLI commands) ─────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',  dim:  '\x1b[2m',
  red:   '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  mag:   '\x1b[35m', cyan:  '\x1b[36m', gray:   '\x1b[90m',
};

function getTime(): string {
  return new Date().toLocaleTimeString('en', { hour12: false });
}

  const HELP = `
  ${c.mag}${c.bold}◆ Nexus${c.reset} — The Definitive Full-Stack Framework

  ${c.bold}Usage:${c.reset}
    nexus <command> [options]

  ${c.bold}Commands:${c.reset}
    dev       Start the development server with HMR + Guard + AI Prefetch
    build     Build for production (runs Nexus Guard on all files)
    start     Start the production server
    add       Install a Nexus Block from the marketplace
    studio    Open the Nexus Studio dev dashboard
    check     Type-check and lint your Nexus app
    audit     Security audit (CVEs, supply chain, CSRF, XSS, secrets, headers)
    fix       Auto-update vulnerable dependencies to patched versions
    routes    Print the route manifest

  ${c.bold}Options:${c.reset}
    --port, -p    Port number (default: 3000)
    --host        Host to bind (default: localhost)
    --root        App root directory (default: .)
    --dry-run     Show what fix would do without applying changes
    --force       Fix medium/low CVEs in addition to critical/high
    --ci          Exit code 1 on critical/high findings (for CI)
    --json        Output audit as JSON
    --help, -h    Show this help
    --version, -v Show version

  ${c.bold}Examples:${c.reset}
    nexus dev
    nexus dev --port 4000
    nexus add auth
    nexus build
    nexus audit
    nexus audit --ci --json    (CI pipeline: JSON output, fails on critical)
    nexus fix                  (auto-update vulnerable packages)
    nexus fix --dry-run        (preview fixes without applying)
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port:      { type: 'string',  short: 'p' },
      host:      { type: 'string' },
      root:      { type: 'string' },
      help:      { type: 'boolean', short: 'h' },
      version:   { type: 'boolean', short: 'v' },
      ci:        { type: 'boolean' },
      json:      { type: 'boolean' },
      fix:       { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      force:     { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (values.version) {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pkg = req('../package.json') as { version: string };
    console.log(`nexus v${pkg.version}`);
    process.exit(0);
  }

  const command = positionals[0] as string | undefined;
  const portVal = values['port'];
  const rootVal = values['root'];
  const portFromCli = typeof portVal === 'string' ? parseInt(portVal, 10) : undefined;
  /** Default for `nexus dev` only — `start` resolves port in runStart (PORT env, nexus.config). */
  const devPort = portFromCli ?? 3000;
  const root = typeof rootVal === 'string' ? rootVal : process.cwd();

  switch (command) {
    case 'dev':
      await runDev({ root, port: devPort });
      break;
    case 'build':
      await runBuild({ root });
      break;
    case 'start':
      await runStart(
        portFromCli !== undefined ? { root, port: portFromCli } : { root },
      );
      break;
    case 'add': {
      const { runAdd } = await import('./add.js');
      const bid = positionals[1];
      await runAdd({ ...(bid !== undefined ? { blockId: bid } : {}), root });
      break;
    }
    case 'studio':
      await runStudio({
        port: typeof portVal === 'string' ? parseInt(portVal, 10) : STUDIO_DEFAULT_PORT,
      });
      break;
    case 'routes':
      await printRoutes({ root });
      break;
    case 'check':
      await runCheck({ root });
      break;
    case 'audit': {
      const { runAudit } = await import('./audit.js');
      await runAudit({
        root,
        ci:   values['ci']   === true,
        json: values['json'] === true,
        fix:  values['fix']  === true,
      });
      break;
    }
    case 'fix': {
      const { runFix } = await import('./fix.js');
      await runFix({
        root,
        dryRun: values['dry-run'] === true,
        force:  values['force']   === true,
      });
      break;
    }
    default:
      if (!command) {
        console.log(HELP);
      } else {
        console.error(`\x1b[31mUnknown command: ${command}\x1b[0m`);
        console.log(HELP);
        process.exit(1);
      }
  }
}

async function runDev(opts: { root: string; port: number }): Promise<void> {
  const _start = Date.now();

  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const pkg = req('../package.json') as { version: string };

  const { loadAppConfig } = await import('./load-app-config.js');
  const cfg = loadAppConfig(opts.root);

  const { createNexusServer } = await import('@nexus_js/server');
  type RequestLogInfo = import('@nexus_js/server').RequestLogInfo;

  const server = await createNexusServer({
    root: opts.root,
    port: opts.port,
    dev: true,
    ...(cfg.security !== undefined
      ? {
          security: {
            hardened: cfg.security.hardened === true,
            ...(cfg.security.shieldLite === true ? { shieldLite: true } : {}),
          },
        }
      : {}),
    ...(cfg.server?.streamingPretext === true ? { streamingPretext: true } : {}),
    ...(cfg.browser?.importMap && Object.keys(cfg.browser.importMap).length > 0
      ? { browserImportMap: cfg.browser.importMap }
      : {}),

    onRequest(info: RequestLogInfo) {
      const mCol = info.method === 'GET' ? c.cyan : c.mag;
      const sCol = info.status >= 500 ? c.red : info.status >= 400 ? c.yellow : c.green;

      let tag = '';
      if (info.isAction) {
        tag = ` ${c.mag}⚡ action${c.reset}`;
      } else if (info.cacheStrategy === 'swr' || info.cacheStrategy === 'static-immutable') {
        tag = ` ${c.green}⚡ cached${c.reset}`;
      } else if (info.cacheStrategy === 'dynamic-no-store' || info.cacheStrategy === 'streaming-no-store') {
        tag = ` ${c.yellow}🌐 dynamic${c.reset}`;
      } else if (info.cacheStrategy === 'private-no-store') {
        tag = ` ${c.gray}🔒 private${c.reset}`;
      }

      process.stdout.write(
        `  ${c.gray}${getTime()}${c.reset}` +
        `  ${mCol}${info.method.padEnd(4)}${c.reset}` +
        `  ${info.path.padEnd(36)}` +
        `  ${sCol}${info.status}${c.reset}` +
        `  ${c.dim}${info.duration}ms${c.reset}` +
        tag + '\n',
      );
    },
  });

  // Wait for the server to be bound before printing the banner
  await server.listen();

  let devRadarUnsub: (() => void) | undefined;
  const obs = cfg.observability;
  const devRadarOn =
    obs?.enabled !== false &&
    process.env['NEXUS_DEVRADAR'] !== '0' &&
    process.env['NEXUS_DEVRADAR'] !== 'false';
  if (devRadarOn) {
    try {
      const { registerDevRadarSink, emitDevRadar } = await import('@nexus_js/server');
      const { broadcast } = await import('./studio.js');
      const { buildSecurityReport } = await import('./security-report.js');
      devRadarUnsub = registerDevRadarSink((e) => {
        broadcast(e as import('./studio.js').StudioEvent);
      });
      emitDevRadar({ type: 'security:report', payload: buildSecurityReport(cfg, opts.root) });
    } catch {
      /* optional */
    }
  }

  if (process.stdout.isTTY) console.clear();

  const elapsed = Date.now() - _start;

  console.log(
    `\n  ${c.mag}${c.bold}◆ NEXUS${c.reset} ${c.dim}v${pkg.version}${c.reset}` +
    `   ${c.green}ready in ${elapsed}ms${c.reset}\n` +
    `\n  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}    ${c.cyan}http://localhost:${opts.port}/${c.reset}` +
    `\n  ${c.green}➜${c.reset}  ${c.bold}Studio${c.reset}   ${c.cyan}http://localhost:${STUDIO_DEFAULT_PORT}/${c.reset}` +
    `   ${c.dim}nexus studio${c.reset}` +
    `\n\n  ${c.dim}Auto-reload:${c.reset}  ${c.dim}src/** · public/** · nexus.config.* · .env · .env.local${c.reset}` +
    `\n  ${c.dim}Browser:${c.reset}       ${c.dim}tabs refresh via SSE when files change${c.reset}` +
    `\n  ${c.dim}CSS:${c.reset}          ${c.dim}styles in .nx / layout are SSR — each save reloads the tab (not Vite HMR)${c.reset}` +
    `\n  ${c.dim}Tip:${c.reset}        ${c.dim}restart \`nexus dev\` after changing .env — Node only loads env at startup.${c.reset}` +
    `\n\n  ${c.dim}press Ctrl+C to stop${c.reset}\n`,
  );

  // Background dependency audit — runs after dev server is ready, non-blocking
  // Shows warnings for critical/high CVEs but never kills the dev server
  void (async () => {
    try {
      // Dynamic import — @nexus_js/audit is optional (gracefully skipped if not installed)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audit: any = await import('@nexus_js/audit');
      const { readFile: rf } = await import('node:fs/promises');
      const { join: pj }    = await import('node:path');

      const pkgJson = JSON.parse(await rf(pj(opts.root, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
      };
      const deps: Record<string, string> = { ...pkgJson.dependencies };

      // CVE check (silent unless findings)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results    = await audit.auditDependencies(deps) as Map<string, any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vulnerable = (audit.filterVulnerable(results) as any[]).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r.vulns[0]?.severity === 'critical' || r.vulns[0]?.severity === 'high',
      );
      if (vulnerable.length > 0) {
        console.log(
          `\n  ${c.yellow}⚠${c.reset}  ${c.bold}Nexus Security${c.reset} — ` +
          `${c.red}${vulnerable.length} vulnerable dep${vulnerable.length > 1 ? 's' : ''}${c.reset} detected\n` +
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vulnerable.map((r: any) => {
            const v = r.vulns[0];
            return `     ${c.red}${r.package}${c.reset}  ${v?.id}  ${String(v?.severity ?? '').toUpperCase()}` +
              (v?.fixedIn ? `  ${c.green}→ fix: v${v.fixedIn}${c.reset}` : '');
          }).join('\n') +
          `\n\n  Run ${c.cyan}nexus fix${c.reset} to auto-update  ·  ${c.cyan}nexus audit${c.reset} for full details\n`,
        );
      }

      // Supply chain check (high/critical risk only)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scResults = await audit.auditSupplyChain(deps) as Map<string, any>;
      for (const [pkg, sc] of scResults) {
        if (sc.riskLevel === 'critical' || sc.riskLevel === 'high') {
          const topFlag = sc.flags[0] as { title: string } | undefined;
          console.log(
            `  ${c.yellow}⚠${c.reset}  ${c.bold}Supply Chain${c.reset}  ${c.yellow}${pkg}${c.reset}` +
            (topFlag ? `  —  ${topFlag.title}` : '') + `  (risk: ${sc.riskScore}/100)`
          );
        }
      }
    } catch {
      // Audit failure (offline, @nexus_js/audit not installed) is silently ignored in dev mode
    }
  })();

  // File watcher — reload routes + clear caches (src tree, config, env)
  const { watch, existsSync } = await import('node:fs');
  const { join, basename } = await import('node:path');
  const srcDir = join(opts.root, 'src');

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const scheduleReload = (label: string, event: string) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      console.log(
        `  ${c.gray}${getTime()}${c.reset}` +
          `  ${c.mag}[reload]${c.reset}` +
          `  ${c.cyan}${label}${c.reset}` +
          `  ${c.dim}${event} — routes + cache${c.reset}`,
      );
      await server.reload();
    }, 120);
  };

  watch(srcDir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    scheduleReload(filename, event);
  });

  const publicDir = join(opts.root, 'public');
  if (existsSync(publicDir)) {
    try {
      watch(publicDir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        scheduleReload(`public/${filename}`, event);
      });
    } catch {
      /* EMFILE etc. */
    }
  }

  const rootWatchFiles = [
    'nexus.config.ts',
    'nexus.config.js',
    'nexus.config.mjs',
    'nexus.config.cjs',
    '.env',
    '.env.local',
  ];
  for (const rel of rootWatchFiles) {
    const abs = join(opts.root, rel);
    if (!existsSync(abs)) continue;
    try {
      watch(abs, (event) => scheduleReload(basename(abs), event));
    } catch {
      /* e.g. EMFILE — ignore */
    }
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    devRadarUnsub?.();
    console.log(`\n  ${c.dim}◆ Nexus stopped${c.reset}\n`);
    server.close();
    process.exit(0);
  });
}

async function runBuild(opts: { root: string }): Promise<void> {
  const _start = Date.now();
  console.log(`\n  ${c.mag}${c.bold}◆ NEXUS${c.reset}  ${c.dim}building for production...${c.reset}\n`);

  const { loadAppConfig } = await import('./load-app-config.js');
  const cfg = loadAppConfig(opts.root);

  const { compile, compileLib } = await import('@nexus_js/compiler');
  const { buildRouteManifest } = await import('@nexus_js/router');
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const routesDir = join(opts.root, 'src', 'routes');
  const outDir = join(opts.root, '.nexus', 'output');

  await mkdir(outDir, { recursive: true });

  // Compile src/lib/**/*.ts → .nexus/lib/**/*.js so server modules can import
  // them at runtime without a TypeScript loader (fixes "Unknown file extension .ts").
  const libResult = await compileLib(opts.root);
  if (libResult.files > 0) {
    console.log(`  ${c.green}✔${c.reset}  Compiled ${c.bold}${libResult.files} lib files${c.reset}  ${c.dim}→ .nexus/lib/${c.reset}`);
  }

  const manifest = await buildRouteManifest(routesDir);

  const failOnIslandSecurity =
    cfg.security?.hardened === true && cfg.security?.failOnIslandSecurity === true;
  const islandSecurityFindings: { file: string; message: string }[] = [];

  let compiled = 0;
  for (const route of manifest.routes) {
    const source = await readFile(route.filepath, 'utf-8');
    const result = compile(source, route.filepath, {
      mode: 'server',
      dev: false,
      emitIslandManifest: true,
      appRoot: opts.root,
      routePattern: route.pattern,
    });

    for (const w of result.warnings ?? []) {
      if (w.message.includes('[security]')) {
        islandSecurityFindings.push({ file: route.filepath, message: w.message });
        console.error(`  ${c.red}✗${c.reset}  ${c.dim}${route.filepath}${c.reset}`);
        console.error(`     ${c.red}${w.message}${c.reset}`);
      }
    }

    const outSeg = route.pattern === '/' ? 'index' : route.pattern.replace(/^\//, '');
    const outPath = join(outDir, outSeg) + '.js';
    await mkdir(join(outPath, '..'), { recursive: true });
    await writeFile(outPath, result.serverCode, 'utf-8');

    if (result.clientCode) {
      await writeFile(outPath.replace('.js', '.client.js'), result.clientCode, 'utf-8');
    }

    if (result.actionsModule) {
      const actionsPath = outPath.replace(/\.js$/u, '.actions.js');
      // The sidecar imports all action handlers from the adjacent server module
      // (which has $lib imports in scope) — no app-specific preamble needed.
      await writeFile(actionsPath, result.actionsModule, 'utf-8');
    }

    compiled++;
  }

  if (failOnIslandSecurity && islandSecurityFindings.length > 0) {
    console.error(
      `\n  ${c.red}Build failed:${c.reset} ${islandSecurityFindings.length} compiler security finding(s). ` +
        `Fix island scripts/templates or set ${c.cyan}security.failOnIslandSecurity: false${c.reset}.\n`,
    );
    process.exit(1);
  }

  // Write route manifest
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  const { collectActionNamesFromOutputDir } = await import('@nexus_js/security');
  const shieldActions = collectActionNamesFromOutputDir(outDir);
  const shieldRoutes = [...new Set(manifest.routes.map((r) => r.pattern))].sort();
  await writeFile(
    join(outDir, 'shield-manifest.json'),
    JSON.stringify({ version: 1, routes: shieldRoutes, actions: shieldActions }, null, 2),
    'utf-8',
  );

  const elapsedCompile = Date.now() - _start;
  console.log(`  ${c.green}✔${c.reset}  Compiled ${c.bold}${compiled} routes${c.reset}  ${c.dim}(${elapsedCompile}ms)${c.reset}`);
  console.log(`  ${c.green}✔${c.reset}  Output → ${c.cyan}.nexus/output/${c.reset}\n`);

  const runSecurityScan = cfg.security?.audit?.blockBuild === true || cfg.security?.hardened === true;
  let auditScanRan = false;
  let auditOk = true;
  let auditVulnerableCount = 0;
  if (runSecurityScan) {
    const auditMod = await import('@nexus_js/audit');
    const { scanProject, NexusSecurityError } = auditMod;
    const block = cfg.security?.audit?.blockBuild === true;
    try {
      auditScanRan = true;
      const scan = await scanProject({
        root:            opts.root,
        supplyChain:     true,
        allowVulnerable: cfg.security?.allowVulnerable ?? {},
        failOnCritical:  block,
        minSeverity:     'high',
      });
      auditVulnerableCount = scan.vulnerable.length;
      auditOk = scan.vulnerable.length === 0;
      if (!block && scan.vulnerable.length > 0) {
        console.log(
          `  ${c.yellow}⚠${c.reset}  ${scan.vulnerable.length} package(s) with CVE findings (non-blocking). ` +
            `Run ${c.cyan}nexus audit${c.reset} for details.\n`,
        );
      } else {
        console.log(`  ${c.green}✔${c.reset}  ${c.dim}Nexus Security: dependency scan complete${c.reset}\n`);
      }
    } catch (e) {
      if (e instanceof NexusSecurityError) {
        console.error(`\n  ${c.red}${(e as Error).message}${c.reset}\n`);
        process.exit(1);
      }
      auditOk = false;
      console.warn(
        `  ${c.yellow}⚠${c.reset}  Nexus Security scan skipped: ${(e as Error).message}\n`,
      );
    }
  }

  try {
    await writeFile(
      join(opts.root, '.nexus', 'last-build-security.json'),
      JSON.stringify(
        {
          at:                     new Date().toISOString(),
          islandSecurityWarnings: islandSecurityFindings.length,
          auditScanRan,
          auditOk,
          auditVulnerableCount,
          hardened:               cfg.security?.hardened === true,
          failOnIslandSecurity:   cfg.security?.failOnIslandSecurity === true,
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch {
    /* ignore */
  }

  const elapsed = Date.now() - _start;
  console.log(`  ${c.dim}Total ${elapsed}ms${c.reset}`);
  console.log(`  Run ${c.bold}nexus start${c.reset} to serve the production build.\n`);
}

function parseEnvPort(): number | undefined {
  const p = process.env['PORT'];
  if (p === undefined || p === '') return undefined;
  const n = parseInt(p, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function runStart(opts: { root: string; port?: number }): Promise<void> {
  const _start = Date.now();

  const { loadAppConfig } = await import('./load-app-config.js');
  const cfg = loadAppConfig(opts.root);

  const port =
    opts.port ??
    parseEnvPort() ??
    (typeof cfg.server?.port === 'number' ? cfg.server.port : undefined) ??
    3000;

  const { createNexusServer } = await import('@nexus_js/server');

  const server = await createNexusServer({
    root: opts.root,
    port,
    dev: false,
    ...(cfg.security !== undefined
      ? {
          security: {
            hardened: cfg.security.hardened === true,
            ...(cfg.security.shieldLite === true ? { shieldLite: true } : {}),
          },
        }
      : {}),
    ...(cfg.server?.streamingPretext === true ? { streamingPretext: true } : {}),
    ...(cfg.browser?.importMap && Object.keys(cfg.browser.importMap).length > 0
      ? { browserImportMap: cfg.browser.importMap }
      : {}),
  });

  await server.listen();

  const elapsed = Date.now() - _start;
  console.log(
    `\n  ${c.mag}${c.bold}◆ NEXUS${c.reset} ${c.dim}production${c.reset}` +
    `   ${c.green}ready in ${elapsed}ms${c.reset}\n` +
    `\n  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}    ${c.cyan}http://localhost:${port}/${c.reset}\n`,
  );

  process.on('SIGINT', () => {
    console.log(`\n  ${c.dim}◆ Nexus stopped${c.reset}\n`);
    server.close();
    process.exit(0);
  });
}

async function printRoutes(opts: { root: string }): Promise<void> {
  const { buildRouteManifest } = await import('@nexus_js/router');
  const { join } = await import('node:path');

  const manifest = await buildRouteManifest(join(opts.root, 'src', 'routes'));

  console.log('\n  \x1b[36m◆ Nexus Route Manifest\x1b[0m\n');
  for (const route of manifest.routes) {
    const kind = route.isLayout ? '\x1b[33mlayout\x1b[0m' : '\x1b[32mpage  \x1b[0m';
    const dynamic = route.isDynamic ? '\x1b[35m[dynamic]\x1b[0m' : '';
    console.log(`  ${kind} ${route.pattern} ${dynamic}`);
  }
  console.log('');
}

async function runStudio(opts: { port: number }): Promise<void> {
  const { startStudio } = await import('./studio.js');
  const studio = await startStudio(opts.port);

  const { exec } = await import('node:child_process');
  exec(`open http://localhost:${studio.port}`);

  process.on('SIGINT', () => { studio.close(); process.exit(0); });

  // Keep alive — the Studio WebSocket server drives everything
  await new Promise(() => {});
}

async function runCheck(opts: { root: string }): Promise<void> {
  console.log(`\n  ${c.mag}${c.bold}◆ NEXUS check${c.reset}  ${c.dim}type-checking your app...${c.reset}\n`);
  const { execFileSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const { existsSync } = await import('node:fs');

  const appPkg = join(opts.root, 'package.json');
  if (!existsSync(appPkg)) {
    console.error(`\n  ${c.red}✖${c.reset}  No package.json at ${opts.root}.\n`);
    process.exit(1);
  }

  /** Run the compiler via Node + lib/tsc.js (no shell, no global `tsc`; works with pnpm hoisting). */
  let tscJs: string;
  try {
    const req = createRequire(appPkg);
    const tsRoot = dirname(req.resolve('typescript/package.json'));
    tscJs = join(tsRoot, 'lib', 'tsc.js');
    if (!existsSync(tscJs)) {
      throw new Error('typescript/lib/tsc.js missing');
    }
  } catch {
    console.error(
      `\n  ${c.red}✖${c.reset}  TypeScript not found for this app. ` +
        `Add it as a devDependency (e.g. ${c.cyan}pnpm add -D typescript${c.reset}).\n`,
    );
    process.exit(1);
  }

  try {
    execFileSync(process.execPath, [tscJs, '--noEmit'], { cwd: opts.root, stdio: 'inherit' });
    console.log(`\n  ${c.green}✔${c.reset}  No type errors found.\n`);
  } catch {
    console.error(`\n  ${c.red}✖${c.reset}  Type errors found.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\x1b[31m[Nexus CLI Error]\x1b[0m', err);
  process.exit(1);
});
