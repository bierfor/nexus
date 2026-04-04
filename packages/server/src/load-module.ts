/**
 * Load route modules in dev (compile .nx → .mjs) and prod (pre-built .js under .nexus/output).
 */

import { compile } from '@nexus_js/compiler';
import { buildRouteManifest } from '@nexus_js/router';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LoadRouteModuleOptions {
  dev: boolean;
  /** App root (where package.json and node_modules live) */
  appRoot: string;
  /** Route pattern from manifest, e.g. `/`, `/editor`, `/blog/:slug` */
  pattern: string;
}

/** Map manifest pattern to the same path segment used by `nexus build`. */
function patternToOutputSegment(pattern: string): string {
  if (pattern === '/') return 'index';
  return pattern.replace(/^\//, '');
}

function compiledServerPath(appRoot: string, pattern: string): string {
  const outDir = join(appRoot, '.nexus', 'output');
  return join(outDir, patternToOutputSegment(pattern)) + '.js';
}

/**
 * Resolve @nexus_js/compiler dist entry + fingerprint. `require.resolve('…/package.json')` fails
 * because package.json is not exported — use `import.meta.resolve` from this module instead.
 */
/** Newest mtime among `dist/*.js` so codegen-only edits invalidate the dev-server cache. */
function maxMtimeMsCompilerDist(distDir: string): number {
  let max = 0;
  try {
    for (const name of readdirSync(distDir)) {
      if (!name.endsWith('.js')) continue;
      max = Math.max(max, statSync(join(distDir, name)).mtimeMs);
    }
  } catch {
    return 0;
  }
  return max;
}

function compilerDistMeta():
  | { entry: string; mtimeMs: number; fingerprint: string }
  | null {
  try {
    const entry = fileURLToPath(import.meta.resolve('@nexus_js/compiler', import.meta.url));
    const distDir = dirname(entry);
    const mtimeMs = Math.max(statSync(entry).mtimeMs, maxMtimeMsCompilerDist(distDir));
    const pkgDir = dirname(distDir);
    const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as {
      version?: string;
    };
    const v = (version.version ?? '0').replace(/[^\w.]/g, '_');
    const fingerprint = `${v}_${Math.floor(mtimeMs)}`;
    return { entry, mtimeMs, fingerprint };
  } catch {
    return null;
  }
}

function devServerCachePath(appRoot: string, nxPath: string, fingerprint: string): string {
  const rel = relative(appRoot, nxPath);
  const safe = rel.replace(/[^a-zA-Z0-9._/-]/g, '_');
  return join(appRoot, '.nexus', 'dev-server', fingerprint, safe + '.mjs');
}

function actionsSidecarPath(serverPath: string): string {
  return serverPath.replace(/\.mjs$/u, '.actions.mjs').replace(/\.js$/u, '.actions.js');
}

/** Auto-import app `$lib` helpers used inside generated action bodies (sidecar has no imports from .nx). */
function actionsImportPreamble(appRoot: string, actionsCode: string): string {
  const rules: Array<{ needle: string; rel: string; name: string }> = [
    { needle: 'appendMessage', rel: 'src/lib/chat-room.js', name: 'appendMessage' },
    { needle: 'validateFlowPayload', rel: 'src/lib/validate-flow.js', name: 'validateFlowPayload' },
    { needle: 'appendVisit', rel: 'src/lib/visit-log.ts', name: 'appendVisit' },
  ];
  const byFile = new Map<string, Set<string>>();
  for (const { needle, rel, name } of rules) {
    if (!actionsCode.includes(needle)) continue;
    const abs = join(appRoot, rel);
    if (!existsSync(abs)) continue;
    let set = byFile.get(abs);
    if (!set) {
      set = new Set();
      byFile.set(abs, set);
    }
    set.add(name);
  }
  const lines: string[] = [];
  for (const [abs, set] of byFile) {
    const names = [...set].sort().join(', ');
    lines.push(`import { ${names} } from ${JSON.stringify(pathToFileURL(abs).href)};\n`);
  }
  return lines.join('');
}

async function writeActionsSidecar(
  appRoot: string,
  serverOutPath: string,
  actionsModule: string,
): Promise<void> {
  const p = actionsSidecarPath(serverOutPath);
  const code = actionsImportPreamble(appRoot, actionsModule) + actionsModule;
  await writeFile(p, code, 'utf-8');
}

/** Max mtime under `src/lib/**` for source files (`.ts`, `.tsx`, `.mts`, `.js`, …) — busts ESM cache in dev. */
async function maxSrcLibMtime(appRoot: string): Promise<number> {
  const libDir = join(appRoot, 'src', 'lib');
  let max = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && /\.(ts|tsx|mts|m?js|cjs)$/iu.test(e.name)) {
        max = Math.max(max, (await stat(p)).mtimeMs);
      }
    }
  }
  await walk(libDir);
  return max;
}

async function collectFilesRecursive(
  dir: string,
  match: (baseName: string) => boolean,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (match(e.name)) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

/**
 * Re-import every `*.actions.mjs` under `.nexus/dev-server` so `registerAction` picks up
 * code changes (including edits to files imported from the sidecar, e.g. `$lib/chat-room.js`).
 * Called from `server.reload()` when the CLI file watcher fires.
 */
/**
 * Loads every route module once so generated `*.actions.*` sidecars run `registerAction`
 * before any HTTP request. Dev: compiles each `.nx` route; prod: imports `*.actions.js` from `.nexus/output`.
 */
export async function preloadRegisteredServerActions(appRoot: string, dev: boolean): Promise<void> {
  if (dev) {
    const routesDir = join(appRoot, 'src', 'routes');
    const manifest = await buildRouteManifest(routesDir);
    const seen = new Set<string>();
    for (const route of manifest.routes) {
      if (!route.filepath.endsWith('.nx')) continue;
      if (seen.has(route.filepath)) continue;
      seen.add(route.filepath);
      try {
        await loadRouteModule(route.filepath, { dev: true, appRoot, pattern: route.pattern });
      } catch (err) {
        console.error(`[Nexus] Failed to preload server actions for ${route.filepath}:`, err);
      }
    }
    await reimportDevActionSidecars(appRoot);
    return;
  }

  const outDir = join(appRoot, '.nexus', 'output');
  let files: string[] = [];
  try {
    files = await collectFilesRecursive(outDir, (n) => n.endsWith('.actions.js'));
  } catch {
    return;
  }
  for (const p of files) {
    try {
      const st = await stat(p);
      await import(`${pathToFileURL(p).href}?t=${st.mtimeMs}`);
    } catch (err) {
      console.error(`[Nexus] Failed to import server actions sidecar (${p}):`, err);
    }
  }
}

export async function reimportDevActionSidecars(appRoot: string): Promise<void> {
  const root = join(appRoot, '.nexus', 'dev-server');
  let files: string[] = [];
  try {
    files = await collectFilesRecursive(root, (n) => n.endsWith('.actions.mjs'));
  } catch {
    return;
  }
  const libM = await maxSrcLibMtime(appRoot);
  for (const p of files) {
    try {
      const st = await stat(p);
      await import(`${pathToFileURL(p).href}?t=${st.mtimeMs}_${libM}`);
    } catch (err) {
      console.error(`[Nexus] Failed to re-import actions (${p}):`, err);
    }
  }
}

async function importActionsSidecar(serverOutPath: string, appRoot: string, dev: boolean): Promise<void> {
  const p = actionsSidecarPath(serverOutPath);
  try {
    await stat(p);
  } catch {
    return;
  }
  try {
    const st = await stat(p);
    const libM = dev ? await maxSrcLibMtime(appRoot) : 0;
    const bust = dev ? `${st.mtimeMs}_${libM}` : `${st.mtimeMs}`;
    await import(`${pathToFileURL(p).href}?t=${bust}`);
  } catch (err) {
    console.error(`[Nexus] Failed to import server actions sidecar (${p}):`, err);
  }
}

/**
 * Dynamic import for `.ts`/`.js` routes, compiled `.nx` in dev, or built `.js` in production.
 */
export async function loadRouteModule(
  filepath: string,
  options: LoadRouteModuleOptions,
): Promise<Record<string, unknown>> {
  if (filepath.endsWith('.ts') || filepath.endsWith('.js') || filepath.endsWith('.mjs')) {
    if (options.dev) {
      const st = await stat(filepath);
      const libM = await maxSrcLibMtime(options.appRoot);
      const bust = `${st.mtimeMs}_${libM}`;
      return import(`${pathToFileURL(filepath).href}?t=${bust}`);
    }
    return import(pathToFileURL(filepath).href);
  }

  if (!filepath.endsWith('.nx')) {
    throw new Error(`[Nexus] Unsupported route module: ${filepath}`);
  }

  const { dev, appRoot, pattern } = options;

  if (!dev) {
    const outFile = compiledServerPath(appRoot, pattern);
    try {
      await stat(outFile);
    } catch {
      throw new Error(
        `[Nexus] No compiled server module for "${pattern}" (${filepath}). Run \`nexus build\` first.`,
      );
    }
    const mod = await import(pathToFileURL(outFile).href);
    await importActionsSidecar(outFile, appRoot, false);
    return mod;
  }

  const nxStat = await stat(filepath);
  const libM = await maxSrcLibMtime(appRoot);
  const cc = compilerDistMeta();
  const fingerprint = cc?.fingerprint ?? 'unknown';
  const outPath = devServerCachePath(appRoot, filepath, fingerprint);

  let needsCompile = true;
  try {
    const outStat = await stat(outPath);
    needsCompile =
      outStat.mtimeMs < nxStat.mtimeMs ||
      (cc !== null && outStat.mtimeMs < cc.mtimeMs) ||
      outStat.mtimeMs < libM;
  } catch {
    needsCompile = true;
  }

  if (needsCompile) {
    const source = await readFile(filepath, 'utf-8');
    const result = compile(source, filepath, {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: true,
      target: 'node',
      appRoot,
      libDepsMtime: libM,
    });
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, result.serverCode, 'utf-8');
    const ap = actionsSidecarPath(outPath);
    if (result.actionsModule) {
      await writeActionsSidecar(appRoot, outPath, result.actionsModule);
    } else {
      try {
        await unlink(ap);
      } catch {
        /* none */
      }
    }
  }

  await importActionsSidecar(outPath, appRoot, true);

  const outStatForUrl = await stat(outPath);
  const cacheBust = Math.max(
    nxStat.mtimeMs,
    outStatForUrl.mtimeMs,
    cc !== null ? cc.mtimeMs : 0,
    libM,
  );
  const url = `${pathToFileURL(outPath).href}?t=${cacheBust}`;
  return import(url);
}
