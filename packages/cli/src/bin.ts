#!/usr/bin/env node
/**
 * Nexus CLI — nexus dev | nexus build | nexus start | nexus check | nexus studio
 */

import { parseArgs } from 'node:util';

const HELP = `
  \x1b[36m◆ Nexus\x1b[0m — The Definitive Full-Stack Framework

  \x1b[1mUsage:\x1b[0m
    nexus <command> [options]

  \x1b[1mCommands:\x1b[0m
    dev       Start the development server with HMR
    build     Build for production
    start     Start the production server
    studio    Open the Nexus Studio dev dashboard
    check     Type-check and lint your Nexus app
    routes    Print the route manifest

  \x1b[1mOptions:\x1b[0m
    --port, -p    Port number (default: 3000)
    --host        Host to bind (default: localhost)
    --root        App root directory (default: .)
    --help, -h    Show this help
    --version, -v Show version

  \x1b[1mExamples:\x1b[0m
    nexus dev
    nexus dev --port 4000
    nexus build
    nexus start
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
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

  const command = positionals[0];
  const port = values.port ? parseInt(values.port, 10) : 3000;
  const root = values.root ?? process.cwd();

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
    case 'studio':
      await runStudio({ port });
      break;
    case 'routes':
      await printRoutes({ root });
      break;
    case 'check':
      await runCheck({ root });
      break;
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
  console.log('\n  \x1b[36m◆ Nexus\x1b[0m starting dev server...\n');

  const { createNexusServer } = await import('@nexus/server');

  const server = await createNexusServer({
    root: opts.root,
    port: opts.port,
    dev: true,
  });

  server.listen();

  // Watch for file changes
  const { watch } = await import('node:fs');
  const { join } = await import('node:path');
  const routesDir = join(opts.root, 'src');

  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  watch(routesDir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(async () => {
      console.log(`  \x1b[33m⚡ HMR\x1b[0m ${filename} changed — reloading routes`);
      await server.reload();
    }, 100);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

async function runBuild(opts: { root: string }): Promise<void> {
  console.log('\n  \x1b[36m◆ Nexus\x1b[0m building for production...\n');

  const { compile } = await import('@nexus/compiler');
  const { buildRouteManifest } = await import('@nexus/router');
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

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
    });

    const outPath = join(outDir, route.pattern === '/' ? 'index' : route.pattern) + '.js';
    await mkdir(join(outPath, '..'), { recursive: true });
    await writeFile(outPath, result.serverCode, 'utf-8');

    if (result.clientCode) {
      await writeFile(outPath.replace('.js', '.client.js'), result.clientCode, 'utf-8');
    }

    compiled++;
  }

  // Write route manifest
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  console.log(`  \x1b[32m✓\x1b[0m Compiled ${compiled} routes`);
  console.log(`  \x1b[32m✓\x1b[0m Output written to .nexus/output/\n`);
  console.log(`  Run \x1b[1mnexus start\x1b[0m to serve the production build.\n`);
}

async function runStart(opts: { root: string; port: number }): Promise<void> {
  console.log('\n  \x1b[36m◆ Nexus\x1b[0m starting production server...\n');

  const { createNexusServer } = await import('@nexus/server');

  const server = await createNexusServer({
    root: opts.root,
    port: opts.port,
    dev: false,
  });

  server.listen();

  process.on('SIGINT', () => {
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
  console.log('\n  \x1b[36m◆ Nexus Check\x1b[0m — type-checking your app...\n');
  const { execSync } = await import('node:child_process');
  try {
    execSync('tsc --noEmit', { cwd: opts.root, stdio: 'inherit' });
    console.log('\n  \x1b[32m✓\x1b[0m No type errors found.\n');
  } catch {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\x1b[31m[Nexus CLI Error]\x1b[0m', err);
  process.exit(1);
});
