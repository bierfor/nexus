/**
 * Dev / Node server assets: /@nexus_js/runtime ESM mirror + aggregated scoped CSS from .nx files.
 */

import { compile } from '@nexus_js/compiler';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, normalize, sep } from 'node:path';

const require = createRequire(import.meta.url);

const RT_PREFIX = '/_nexus/rt/';
const LAYER_DECL = '@layer nexus.scoped, nexus.global;\n';

let aggregatedCssCache: string | null = null;

export function bustAggregatedStylesCache(): void {
  aggregatedCssCache = null;
}

/**
 * Locate `@nexus_js/runtime/dist` without `require.resolve` (pnpm "exports" blocks package.json / bare resolve from apps).
 */
export function resolveRuntimeDistDir(appRoot: string): string | null {
  const candidates = [
    join(appRoot, 'node_modules', '@nexus_js', 'runtime', 'dist'),
    // pnpm workspace: deps often hoisted — parent may have node_modules
    join(appRoot, '..', 'node_modules', '@nexus_js', 'runtime', 'dist'),
    // App one level under monorepo root (e.g. nexus/mi-app → nexus/packages/runtime)
    join(appRoot, '..', 'packages', 'runtime', 'dist'),
    join(appRoot, '..', '..', 'packages', 'runtime', 'dist'),
    // Dev from monorepo root with --root .
    join(appRoot, 'packages', 'runtime', 'dist'),
  ];
  for (const d of candidates) {
    if (existsSync(join(d, 'index.js'))) return d;
  }
  return null;
}

/**
 * Locate `@nexus_js/serialize/dist` — served to the browser at `/_nexus/rt/serialize.js`.
 */
export function resolveSerializeDistFile(appRoot: string): string | null {
  try {
    const pkgJson = require.resolve('@nexus_js/serialize/package.json');
    const fromRequire = join(dirname(pkgJson), 'dist', 'index.js');
    if (existsSync(fromRequire)) return fromRequire;
  } catch {
    /* not resolvable from server package graph */
  }
  const candidates = [
    join(appRoot, 'node_modules', '@nexus_js', 'serialize', 'dist', 'index.js'),
    join(appRoot, '..', 'node_modules', '@nexus_js', 'serialize', 'dist', 'index.js'),
    join(appRoot, '..', 'packages', 'serialize', 'dist', 'index.js'),
    join(appRoot, '..', '..', 'packages', 'serialize', 'dist', 'index.js'),
  ];
  for (const f of candidates) {
    if (existsSync(f)) return f;
  }
  return null;
}

/** Safe basename-only files under runtime dist (no ..). Allows .js and .map (source maps). */
export function runtimeModulePath(runtimeDist: string, pathname: string): string | null {
  if (!pathname.startsWith(RT_PREFIX)) return null;
  const name = pathname.slice(RT_PREFIX.length);
  if (!/^[\w.-]+\.(js|map)$/.test(name) || name.includes('..')) return null;
  return join(runtimeDist, name);
}

async function collectNxFiles(dir: string): Promise<string[]> {
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
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        await walk(p);
      } else if (e.name.endsWith('.nx')) {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out;
}

/**
 * Concatenate scoped CSS from every .nx under src/ (routes + components).
 */
export async function buildAggregatedNxStylesheet(appRoot: string): Promise<string> {
  if (aggregatedCssCache !== null) return aggregatedCssCache;

  const srcDir = join(appRoot, 'src');
  const files = await collectNxFiles(srcDir);
  const parts: string[] = [LAYER_DECL];

  for (const filepath of files) {
    const source = await readFile(filepath, 'utf-8');
    const result = compile(source, filepath, {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
    });
    if (result.css) parts.push(`/* ${relative(appRoot, filepath)} */\n${result.css}`);
  }

  aggregatedCssCache = parts.join('\n');
  return aggregatedCssCache;
}

const ISLAND_CLIENT_PATH = '/_nexus/islands/client.mjs';

/**
 * Compiles a .nx file's client island bundle for dynamic import() during hydration.
 */
export async function compileIslandClientBundle(
  appRoot: string,
  url: URL,
): Promise<{ body: string; status: number }> {
  const pathParam = url.searchParams.get('path');
  const absParam = url.searchParams.get('abs');
  const rootReal = resolve(appRoot);

  function isUnderRoot(file: string): boolean {
    const rel = relative(rootReal, resolve(file));
    if (rel === '..') return false;
    if (rel.startsWith(`..${sep}`)) return false;
    return true;
  }

  let nxPath: string | null = null;
  if (pathParam) {
    if (pathParam.includes('..') || pathParam.startsWith('/')) {
      return { body: 'Invalid path', status: 400 };
    }
    const joined = resolve(join(rootReal, normalize(pathParam)));
    if (!isUnderRoot(joined)) {
      return { body: 'Path escapes app root', status: 400 };
    }
    nxPath = joined;
  } else if (absParam) {
    const decoded = decodeURIComponent(absParam);
    const abs = resolve(decoded);
    if (!isUnderRoot(abs)) {
      return { body: 'Invalid abs path', status: 400 };
    }
    nxPath = abs;
  } else {
    return { body: 'Missing path or abs query', status: 400 };
  }

  if (!nxPath.endsWith('.nx')) {
    return { body: 'Not an .nx source', status: 400 };
  }

  try {
    await stat(nxPath);
  } catch {
    return { body: 'Source not found', status: 404 };
  }

  const source = await readFile(nxPath, 'utf-8');
  const result = compile(source, nxPath, {
    mode: 'server',
    dev: true,
    ssr: true,
    emitIslandManifest: false,
    target: 'node',
    appRoot: rootReal,
  });

  if (!result.clientCode) {
    return { body: 'No client island for this module', status: 404 };
  }

  return { body: result.clientCode, status: 200 };
}

export function isIslandClientRequest(pathname: string): boolean {
  return pathname === ISLAND_CLIENT_PATH;
}

const LIB_PREFIX = '/_nexus/lib/';
const LIB_EXTENSIONS = ['.js', '.mjs', '.ts', '.tsx', '.mts'];

/**
 * Serves `$lib/…` files for client islands.
 *
 * Candidate order for JS files (first match wins):
 *   1. `.nexus/output/lib/`  — minified static files written by `nexus build` (production)
 *   2. `.nexus/lib/`         — plain-transpiled output of `compileLib` (build fallback)
 *   3. `src/lib/`            — TypeScript source (dev, served with tsx/strip-types)
 *
 * Source maps (`.js.map`): served exclusively from `.nexus/output/lib/` — they
 * are only generated by the production build step and have no dev equivalent.
 *
 * Returns null when the path doesn't match `/_nexus/lib/`.
 */
export async function tryServeLibAsset(
  pathname: string,
  appRoot: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!pathname.startsWith(LIB_PREFIX)) return null;

  const rel = pathname.slice(LIB_PREFIX.length);
  // Prevent path traversal
  if (rel.includes('..') || rel.startsWith('/')) return null;

  const root = resolve(appRoot);

  // Source-map files are only written by `nexus build` — serve from output/lib/ only.
  if (rel.endsWith('.map')) {
    const mapPath = join(root, '.nexus', 'output', 'lib', rel);
    try {
      const s = await stat(mapPath);
      if (s.isFile()) {
        const body = await readFile(mapPath);
        return { body, contentType: 'application/json; charset=utf-8' };
      }
    } catch { /* not found */ }
    return null;
  }

  const hasKnownExt = /\.(js|mjs|cjs|ts|tsx|mts)$/.test(rel);

  // Strip content hash (e.g. `utils/date.a1b2c3d4.js` → `utils/date.js`) so that
  // dev-server fallbacks (.nexus/lib, src/lib) can be found without hashed names.
  const unhashedRel = rel.replace(/\.([0-9a-f]{8})\.js$/u, '.js');

  const candidates: string[] = [];
  const outputLibBase  = join(root, '.nexus', 'output', 'lib', rel);
  const nexusLibBase   = join(root, '.nexus', 'lib', unhashedRel);
  const srcLibBase     = join(root, 'src', 'lib', unhashedRel);

  if (hasKnownExt) {
    candidates.push(outputLibBase, nexusLibBase, srcLibBase);
  } else {
    for (const ext of LIB_EXTENSIONS) {
      candidates.push(outputLibBase + ext, nexusLibBase + ext, srcLibBase + ext);
    }
  }

  for (const candidate of candidates) {
    try {
      const s = await stat(candidate);
      if (!s.isFile()) continue;
      const body = await readFile(candidate);
      return { body, contentType: 'application/javascript; charset=utf-8' };
    } catch {
      // try next candidate
    }
  }

  return null;
}

export async function tryServeRuntimeAsset(
  pathname: string,
  appRoot: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  // Special alias: /_nexus/rt/serialize.js → @nexus_js/serialize/dist/index.js
  if (pathname === '/_nexus/rt/serialize.js') {
    const serializeFile = resolveSerializeDistFile(appRoot);
    if (!serializeFile) return null;
    try {
      const s = await stat(serializeFile);
      if (!s.isFile()) return null;
      const body = await readFile(serializeFile);
      return { body, contentType: 'application/javascript; charset=utf-8' };
    } catch {
      return null;
    }
  }

  const dist = resolveRuntimeDistDir(appRoot);
  if (!dist) return null;
  const file = runtimeModulePath(dist, pathname);
  if (!file) return null;
  try {
    const s = await stat(file);
    if (!s.isFile()) return null;
    const body = await readFile(file);
    const name = pathname.slice(RT_PREFIX.length);
    const contentType = name.endsWith('.map')
      ? 'application/json; charset=utf-8'
      : 'application/javascript; charset=utf-8';
    return { body, contentType };
  } catch {
    return null;
  }
}
