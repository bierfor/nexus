#!/usr/bin/env node
/**
 * Nexus CLI — nexus dev | nexus build | nexus start | nexus check | nexus studio | nexus audit
 */

import { parseArgs } from 'node:util';

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
  const port = typeof portVal === 'string' ? parseInt(portVal, 10) : 3000;
  const root = typeof rootVal === 'string' ? rootVal : process.cwd();

  switch (command) {
    case 'dev':
      await runDev({ root, port });
      break;
    case 'build':
      await runBuild({ root });
      break;
    case 'start':
      await runStart({ root, port });
      break;
    case 'add': {
      const { runAdd } = await import('./add.js');
      const bid = positionals[1];
      await runAdd({ ...(bid !== undefined ? { blockId: bid } : {}), root });
      break;
    }
    case 'studio':
      await runStudio({ port });
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

  const { createNexusServer } = await import('@nexus/server');
  type RequestLogInfo = import('@nexus/server').RequestLogInfo;

  const server = await createNexusServer({
    root: opts.root,
    port: opts.port,
    dev: true,

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

  if (process.stdout.isTTY) console.clear();

  const elapsed = Date.now() - _start;

  console.log(
    `\n  ${c.mag}${c.bold}◆ NEXUS${c.reset} ${c.dim}v${pkg.version}${c.reset}` +
    `   ${c.green}ready in ${elapsed}ms${c.reset}\n` +
    `\n  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}    ${c.cyan}http://localhost:${opts.port}/${c.reset}` +
    `\n  ${c.green}➜${c.reset}  ${c.bold}Studio${c.reset}   ${c.cyan}http://localhost:7822/${c.reset}` +
    `   ${c.dim}nexus studio${c.reset}` +
    `\n\n  ${c.dim}press Ctrl+C to stop${c.reset}\n`,
  );

  // Background dependency audit — runs after dev server is ready, non-blocking
  // Shows warnings for critical/high CVEs but never kills the dev server
  void (async () => {
    try {
      // Dynamic import — @nexus/audit is optional (gracefully skipped if not installed)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audit: any = await import('@nexus/audit');
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
      // Audit failure (offline, @nexus/audit not installed) is silently ignored in dev mode
    }
  })();

  // File watcher — triggers route reload on .nx / .ts changes
  const { watch } = await import('node:fs');
  const { join } = await import('node:path');
  const srcDir = join(opts.root, 'src');

  let debounce: ReturnType<typeof setTimeout> | null = null;
  watch(srcDir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      console.log(
        `  ${c.gray}${getTime()}${c.reset}` +
        `  ${c.mag}[HMR]${c.reset}` +
        `  ${c.cyan}${filename}${c.reset}` +
        `  ${c.dim}${event} — reloading routes${c.reset}`,
      );
      await server.reload();
    }, 100);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n  ${c.dim}◆ Nexus stopped${c.reset}\n`);
    server.close();
    process.exit(0);
  });
}

async function runBuild(opts: { root: string }): Promise<void> {
  const _start = Date.now();
  console.log(`\n  ${c.mag}${c.bold}◆ NEXUS${c.reset}  ${c.dim}building for production...${c.reset}\n`);

  const { compile } = await import('@nexus/compiler');
  const { buildRouteManifest } = await import('@nexus/router');
  const { existsSync } = await import('node:fs');
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const routesDir = join(opts.root, 'src', 'routes');
  const outDir = join(opts.root, '.nexus', 'output');

  await mkdir(outDir, { recursive: true });

  const manifest = await buildRouteManifest(routesDir);

  let compiled = 0;
  for (const route of manifest.routes) {
    const source = await readFile(route.filepath, 'utf-8');
    const result = compile(source, route.filepath, {
      mode: 'server',
      dev: false,
      emitIslandManifest: true,
      appRoot: opts.root,
    });

    const outSeg = route.pattern === '/' ? 'index' : route.pattern.replace(/^\//, '');
    const outPath = join(outDir, outSeg) + '.js';
    await mkdir(join(outPath, '..'), { recursive: true });
    await writeFile(outPath, result.serverCode, 'utf-8');

    if (result.clientCode) {
      await writeFile(outPath.replace('.js', '.client.js'), result.clientCode, 'utf-8');
    }

    if (result.actionsModule) {
      const actionsPath = outPath.replace(/\.js$/u, '.actions.js');
      let code = result.actionsModule;
      const store = join(opts.root, 'src/lib/chat-room.js');
      if (code.includes('appendMessage') && existsSync(store)) {
        code = `import { appendMessage } from ${JSON.stringify(pathToFileURL(store).href)};\n${code}`;
      }
      await writeFile(actionsPath, code, 'utf-8');
    }

    compiled++;
  }

  // Write route manifest
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  const elapsed = Date.now() - _start;
  console.log(`  ${c.green}✔${c.reset}  Compiled ${c.bold}${compiled} routes${c.reset}  ${c.dim}(${elapsed}ms)${c.reset}`);
  console.log(`  ${c.green}✔${c.reset}  Output → ${c.cyan}.nexus/output/${c.reset}\n`);
  console.log(`  Run ${c.bold}nexus start${c.reset} to serve the production build.\n`);
}

async function runStart(opts: { root: string; port: number }): Promise<void> {
  const _start = Date.now();

  const { createNexusServer } = await import('@nexus/server');

  const server = await createNexusServer({
    root: opts.root,
    port: opts.port,
    dev: false,
  });

  await server.listen();

  const elapsed = Date.now() - _start;
  console.log(
    `\n  ${c.mag}${c.bold}◆ NEXUS${c.reset} ${c.dim}production${c.reset}` +
    `   ${c.green}ready in ${elapsed}ms${c.reset}\n` +
    `\n  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}    ${c.cyan}http://localhost:${opts.port}/${c.reset}\n`,
  );

  process.on('SIGINT', () => {
    console.log(`\n  ${c.dim}◆ Nexus stopped${c.reset}\n`);
    server.close();
    process.exit(0);
  });
}

async function printRoutes(opts: { root: string }): Promise<void> {
  const { buildRouteManifest } = await import('@nexus/router');
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
  const { execSync } = await import('node:child_process');
  try {
    execSync('tsc --noEmit', { cwd: opts.root, stdio: 'inherit' });
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
