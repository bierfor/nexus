/**
 * Dev / Node server assets: /@nexus_js/runtime ESM mirror + aggregated scoped CSS from .nx files.
 */

import { compile } from '@nexus_js/compiler';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, normalize, sep } from 'node:path';

const require = createRequire(import.meta.url);

const RT_PREFIX = '/_nexus/rt/';
const LAYER_DECL = '@layer nexus.scoped, nexus.global;\n';

let aggregatedCssCache: string | null = null;
/**
 * SHA-1 ETag for the current aggregated CSS.  Quoted per RFC 7232 so it can
 * be used directly in `ETag` / `If-None-Match` headers without extra quoting.
 * Reset to null whenever the cache is busted.
 */
let aggregatedCssETag: string | null = null;
/**
 * In-flight deduplication: when multiple requests arrive simultaneously after
 * `bustAggregatedStylesCache()` clears the cache, they all await the same
 * promise instead of each launching a parallel compile sweep.
 */
let aggregatedCssBuildInFlight: Promise<string> | null = null;
/**
 * Generation counter — incremented by every `bustAggregatedStylesCache()` call.
 * A build that completes after a bust compares its snapshot against the current
 * generation and skips writing to the cache if they differ, preventing a stale
 * build from overwriting a fresher one that started after the bust.
 */
let aggregatedCssBuildGeneration = 0;

export function bustAggregatedStylesCache(): void {
  aggregatedCssCache         = null;
  aggregatedCssETag          = null;
  aggregatedCssBuildInFlight = null;
  aggregatedCssBuildGeneration++;
}

// ── Global CSS (dev) ─────────────────────────────────────────────────────────
// Processes src/app.css | src/global.css | src/index.css | src/styles.css
// with optional PostCSS/Tailwind support so global stylesheets survive SSR.

let globalCssCache: string | null = null;
let globalCssETag: string | null = null;
let globalCssBuildInFlight: Promise<string | null> | null = null;
let globalCssBuildGeneration = 0;
let globalCssEntryPath: string | null = null;

export function bustGlobalStylesCache(): void {
  globalCssCache = null;
  globalCssETag = null;
  globalCssBuildInFlight = null;
  globalCssBuildGeneration++;
  globalCssEntryPath = null;
}

export function getGlobalCssETag(): string | null {
  return globalCssETag;
}

function isUnderAppRoot(appRoot: string, target: string): boolean {
  const rel = relative(resolve(appRoot), resolve(target));
  if (rel === '..') return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return true;
}

function findGlobalCssEntry(appRoot: string, customEntry?: string): string | null {
  if (customEntry) {
    const p = join(appRoot, customEntry);
    // Guard against path-traversal via malicious config (e.g. entry: '../../../etc/passwd')
    if (!isUnderAppRoot(appRoot, p)) {
      process.stdout.write(
        `\x1b[33m[Nexus] CSS entry escapes app root and was ignored: ${customEntry}\x1b[0m\n`,
      );
      return null;
    }
    if (existsSync(p)) return p;
    return null;
  }
  const candidates = [
    join(appRoot, 'src', 'app.css'),
    join(appRoot, 'src', 'global.css'),
    join(appRoot, 'src', 'index.css'),
    join(appRoot, 'src', 'styles.css'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function buildGlobalStylesheet(
  appRoot: string,
  customEntry?: string,
): Promise<string | null> {
  const entry = findGlobalCssEntry(appRoot, customEntry);
  if (!entry) return null;
  if (globalCssCache !== null && globalCssEntryPath === entry) return globalCssCache;
  if (globalCssBuildInFlight !== null) return globalCssBuildInFlight;

  const myGeneration = globalCssBuildGeneration;
  let promise!: Promise<string | null>;
  promise = (async (): Promise<string | null> => {
    try {
      const raw = await readFile(entry, 'utf-8');
      let css = raw;

      // Optional PostCSS processing (Tailwind, Autoprefixer, etc.)
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — postcss is an optional peer dependency
        const postcssMod = await import('postcss');
        const postcss = (postcssMod as any).default ?? postcssMod;
        const plugins: unknown[] = [];

        // Attempt to load postcss.config.{mjs,cjs,js}
        try {
          for (const cfgName of ['postcss.config.mjs', 'postcss.config.cjs', 'postcss.config.js']) {
            const cfgPath = join(appRoot, cfgName);
            if (existsSync(cfgPath)) {
              const mod = await import(cfgPath);
              const cfg = mod.default ?? mod;
              if (Array.isArray(cfg.plugins)) {
                for (const plug of cfg.plugins) plugins.push(plug);
              } else if (cfg.plugins && typeof cfg.plugins === 'object') {
                for (const plug of Object.values(cfg.plugins as Record<string, unknown>)) {
                  plugins.push(plug);
                }
              }
              break;
            }
          }
        } catch {
          /* no PostCSS config found */
        }

        const result = await postcss(plugins).process(css, { from: entry, to: entry });
        css = result.css;
      } catch {
        // PostCSS not installed or failed — serve raw CSS so the user at least
        // sees plain CSS classes even if @tailwind directives are unprocessed.
      }

      if (globalCssBuildGeneration === myGeneration) {
        globalCssCache = css;
        globalCssETag = `"${createHash('sha1').update(css).digest('hex').slice(0, 16)}"`;
        globalCssEntryPath = entry;
      }
      return css;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\x1b[33m[Nexus] Global CSS build failed: ${msg}\x1b[0m\n`);
      return null;
    } finally {
      if (globalCssBuildInFlight === promise) {
        globalCssBuildInFlight = null;
      }
    }
  })();

  globalCssBuildInFlight = promise;
  return promise;
}

/**
 * Return the ETag for the most-recently compiled aggregated stylesheet, or
 * null when no compiled result is available yet.  Called by the request
 * handler to implement conditional-GET / 304 responses.
 */
export function getAggregatedCssETag(): string | null {
  return aggregatedCssETag;
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
 *
 * Concurrent callers share a single in-flight build promise so a burst of
 * requests after `bustAggregatedStylesCache()` does not launch N parallel
 * compile sweeps.  A generation counter prevents a stale in-flight build from
 * overwriting a cache that was reset while the build was running.
 */
export async function buildAggregatedNxStylesheet(appRoot: string): Promise<string> {
  if (aggregatedCssCache         !== null) return aggregatedCssCache;
  if (aggregatedCssBuildInFlight !== null) return aggregatedCssBuildInFlight;

  // Snapshot the generation at build-start so we can detect an intervening bust.
  const myGeneration = aggregatedCssBuildGeneration;

  let promise!: Promise<string>;
  promise = (async (): Promise<string> => {
    try {
      const srcDir = join(appRoot, 'src');
      const files = await collectNxFiles(srcDir);
      const parts: string[] = [LAYER_DECL];

      for (const filepath of files) {
        // Per-file isolation: a single .nx component with a temporary syntax
        // error (e.g. editor mid-save) must not abort the entire CSS build.
        // Skip the failing file with a console warning and keep going.
        try {
          const source = await readFile(filepath, 'utf-8');
          const result = compile(source, filepath, {
            mode: 'server',
            dev: true,
            ssr: true,
            emitIslandManifest: false,
            target: 'node',
          });
          if (result.css) parts.push(`/* ${relative(appRoot, filepath)} */\n${result.css}`);
        } catch (fileErr) {
          const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
          process.stdout.write(
            `\x1b[33m[Nexus] CSS: skipping ${relative(appRoot, filepath)}: ${msg}\x1b[0m\n`,
          );
        }
      }

      const css = parts.join('\n');
      // Only populate the cache when no bust happened while we were building.
      // If the generation advanced, leave the cache empty so the next request
      // triggers a fresh build against up-to-date sources.
      if (aggregatedCssBuildGeneration === myGeneration) {
        aggregatedCssCache = css;
        aggregatedCssETag  = `"${createHash('sha1').update(css).digest('hex').slice(0, 16)}"`;
      }
      return css;
    } finally {
      // Always clear the in-flight promise (success OR failure) when it still
      // points to this exact build. Identity check avoids clobbering a newer
      // in-flight build started after a cache bust.
      if (aggregatedCssBuildInFlight === promise) {
        aggregatedCssBuildInFlight = null;
      }
    }
  })();

  aggregatedCssBuildInFlight = promise;
  return promise;
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

  // All error bodies in this function must be syntactically valid JavaScript.
  // The response always carries content-type: application/javascript so the
  // browser will attempt to parse it as a module.  Plain English strings like
  // "Source not found" would parse as bare identifiers and produce confusing
  // SyntaxErrors in the console.  `throw new Error(...)` is always valid.
  function jsError(msg: string, status: number): { body: string; status: number } {
    return { body: `throw new Error(${JSON.stringify(`[Nexus] ${msg}`)});`, status };
  }

  let nxPath: string | null = null;
  if (pathParam) {
    if (pathParam.includes('..') || pathParam.startsWith('/')) {
      return jsError('Island request: invalid path', 400);
    }
    const joined = resolve(join(rootReal, normalize(pathParam)));
    if (!isUnderRoot(joined)) {
      return jsError('Island request: path escapes app root', 400);
    }
    nxPath = joined;
  } else if (absParam) {
    const decoded = decodeURIComponent(absParam);
    const abs = resolve(decoded);
    if (!isUnderRoot(abs)) {
      return jsError('Island request: invalid abs path', 400);
    }
    nxPath = abs;
  } else {
    return jsError('Island request: missing path or abs query', 400);
  }

  if (!nxPath.endsWith('.nx')) {
    return jsError('Island request: not an .nx source', 400);
  }

  try {
    await stat(nxPath);
  } catch {
    return jsError(`Island source not found: ${nxPath}`, 404);
  }

  // `readFile` and `compile` are both fallible — a file that is mid-write
  // during hot-reload can produce a read error or a parse error in the
  // compiler.  Without a try/catch the exception propagates to the generic
  // request-handler catch block which sends `content-type: text/html`, causing
  // the browser to see HTML at a URL it is trying to `import()` as a module,
  // producing misleading `SyntaxError: Unexpected token '<'` (or similar).
  let source: string;
  try {
    source = await readFile(nxPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsError(`Island source could not be read: ${msg}`, 500);
  }

  let clientCode: string | null;
  try {
    const result = compile(source, nxPath, {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
      appRoot: rootReal,
    });
    clientCode = result.clientCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsError(`Island compile error: ${msg}`, 500);
  }

  if (!clientCode) {
    return jsError(`No client island in ${nxPath}`, 404);
  }

  return { body: clientCode, status: 200 };
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _dev?: boolean,
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
