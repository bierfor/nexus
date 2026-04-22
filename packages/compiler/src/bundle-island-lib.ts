/**
 * Bundle $lib dependencies for client islands into .nexus/output/lib/.
 *
 * Content-hashing strategy
 * ────────────────────────
 * Each bundled lib file is content-hashed (SHA-1, 8 hex chars) and written as
 * `<name>.<hash>.js` (e.g. `utils/date.a1b2c3d4.js`).  A manifest that maps
 * canonical rel paths to their hashed counterparts is returned so that callers
 * can rewrite island import URLs after the fact.
 *
 * Two-pass build flow (bin.ts)
 * ────────────────────────────
 * 1. compile() produces island codes with plain `/_nexus/lib/utils/date.js` URLs.
 * 2. bundleIslandLib() hashes every lib file → returns manifest.
 * 3. applyLibManifestToClientCode() rewrites the already-compiled island codes
 *    and overwrites the .client.js files on disk.
 *
 * Tree-shaking strategy
 * ─────────────────────
 * esbuild `build()` is run once per lib file with a synthetic re-export entry
 * that names only the symbols actually imported by islands.  Unused exports and
 * dead internal helpers are eliminated before hashing.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative } from 'node:path';

const LIB_URL_PREFIX = '/_nexus/lib/';

const PROBE_SUFFIXES = [
  '',
  '.js',
  '/index.js',
  '.ts',
  '/index.ts',
  '.tsx',
  '/index.tsx',
  '.mts',
  '/index.mts',
] as const;

// ─── Resolution helpers ───────────────────────────────────────────────────────

/** Extract all `/_nexus/lib/…` specifiers from generated island client code. */
export function extractLibImports(code: string): string[] {
  const results: string[] = [];
  const re = /from\s*['"](\/_nexus\/lib\/[^'"]+)['"]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1]) results.push(m[1]);
  }
  return results;
}

/**
 * Resolve a relative path to an actual file inside `nexusLibDir`.
 * Uses `statSync` to confirm the candidate is a file (not a directory),
 * probing `.js`, `/index.js`, `.ts`, `/index.ts` etc.
 */
function resolveInNexusLib(nexusLibDir: string, rel: string): string | null {
  const base = join(nexusLibDir, rel);
  const baseNoTs = base.replace(/\.(ts|tsx|mts)$/u, '');
  const probeBase = baseNoTs !== base ? baseNoTs : base;

  const seen = new Set<string>();
  for (const suffix of PROBE_SUFFIXES) {
    const candidate = suffix === '' ? base : probeBase + suffix;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* not found or not a file */ }
  }
  return null;
}

/**
 * Stable deduplication key: path relative to nexusLibDir, always `.js`.
 * `'utils/date'`, `'utils/date.ts'`, `'utils/date.js'` all map to the same key.
 */
function canonicalRel(nexusLibDir: string, absFile: string): string {
  return relative(nexusLibDir, absFile).replace(/\.(ts|tsx|mts)$/u, '.js');
}

// ─── Content hashing ─────────────────────────────────────────────────────────

function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

/** `'utils/date.js'` + hash → `'utils/date.a1b2c3d4.js'` */
function insertHash(canonRel: string, hash: string): string {
  return canonRel.replace(/\.js$/u, `.${hash}.js`);
}

// ─── Import-usage analysis ────────────────────────────────────────────────────

interface LibUsage {
  named: Set<string>;
  hasDefault: boolean;
  hasNamespace: boolean;
}

function collectLibUsage(codes: string[], nexusLibDir: string): Map<string, LibUsage> {
  const result = new Map<string, LibUsage>();

  function getOrCreate(canon: string): LibUsage {
    let u = result.get(canon);
    if (!u) {
      u = { named: new Set(), hasDefault: false, hasNamespace: false };
      result.set(canon, u);
    }
    return u;
  }

  for (const code of codes) {
    const specRe = /\bimport\b([\s\S]*?)\bfrom\s*['"](\/_nexus\/lib\/[^'"]+)['"]/gu;
    let m: RegExpExecArray | null;
    while ((m = specRe.exec(code)) !== null) {
      const clause = (m[1] ?? '').trim();
      const spec = m[2];
      if (!spec) continue;
      if (/^type\s/.test(clause)) continue;

      const rel      = spec.slice(LIB_URL_PREFIX.length);
      const resolved = resolveInNexusLib(nexusLibDir, rel);
      if (!resolved) continue;
      const canon = canonicalRel(nexusLibDir, resolved);
      const usage = getOrCreate(canon);

      if (clause.includes('*')) { usage.hasNamespace = true; continue; }

      const braceMatch = /\{([^}]*)\}/.exec(clause);
      if (braceMatch) {
        const body = braceMatch[1];
        if (!body) continue;
        for (const part of body.split(',')) {
          const trimmed = part.trim();
          if (!trimmed || trimmed.startsWith('type ')) continue;
          const first = trimmed.split(/\s+as\s+/u)[0];
          const name = first ? first.trim() : '';
          if (name && /^[a-zA-Z_$]/.test(name)) usage.named.add(name);
        }
      }

      const beforeBrace = clause.replace(/\{[^}]*\}/u, '').trim();
      if (beforeBrace && /^[a-zA-Z_$][\w$]*$/.test(beforeBrace)) usage.hasDefault = true;
    }
  }

  return result;
}

function buildSyntheticEntry(actualFile: string, usage: LibUsage): string | null {
  const path = JSON.stringify(actualFile);
  if (usage.hasNamespace) {
    const lines = [`export * from ${path};`];
    if (usage.hasDefault) lines.push(`export { default } from ${path};`);
    return lines.join('\n');
  }
  const reExports = [...usage.named];
  if (usage.hasDefault) reExports.unshift('default');
  if (reExports.length === 0) return null;
  return `export { ${reExports.join(', ')} } from ${path};`;
}

// ─── Post-processing helper ───────────────────────────────────────────────────

/**
 * Rewrite `/_nexus/lib/X.js` → `/_nexus/lib/X.<hash>.js` in already-compiled
 * island client code using the manifest returned by `bundleIslandLib`.
 *
 * Called in the build pipeline after `bundleIslandLib` completes, to update
 * the `.client.js` files that were written before the manifest was available.
 */
export function applyLibManifestToClientCode(
  code: string,
  manifest: ReadonlyMap<string, string>,
): string {
  if (manifest.size === 0) return code;
  return code.replace(/from\s*['"](\/_nexus\/lib\/[^'"]+)['"]/gu, (full, spec: string) => {
    const rel   = spec.slice(LIB_URL_PREFIX.length);
    // Normalise: the specifier may carry .ts extension (from rewriteDollarLibImportsForClient).
    const jsRel = rel.replace(/\.(ts|tsx|mts)$/u, '.js');
    const hashed = manifest.get(jsRel) ?? manifest.get(`${rel}.js`) ?? manifest.get(rel);
    return hashed ? `from ${JSON.stringify(`${LIB_URL_PREFIX}${hashed}`)}` : full;
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface BundleIslandLibResult {
  /** Number of lib files written to `<outDir>/lib/`. */
  files: number;
  /**
   * Maps canonical rel path → hashed rel path.
   * e.g. `'utils/date.js'` → `'utils/date.a1b2c3d4.js'`
   */
  manifest: Map<string, string>;
}

/**
 * Bundle all `$lib` files imported by island client scripts into
 * `<outDir>/lib/`, tree-shaking unused exports and content-hashing each file.
 */
export async function bundleIslandLib(
  appRoot: string,
  outDir: string,
  clientCodes: string[],
): Promise<BundleIslandLibResult> {
  if (clientCodes.length === 0) return { files: 0, manifest: new Map() };

  const root        = normalize(appRoot);
  const nexusLibDir = join(root, '.nexus', 'lib');
  const libOutDir   = join(outDir, 'lib');

  const usageMap = collectLibUsage(clientCodes, nexusLibDir);
  if (usageMap.size === 0) return { files: 0, manifest: new Map() };

  let esbuildBuild: typeof import('esbuild').build | null = null;
  try {
    const mod = await import('esbuild');
    esbuildBuild = mod.build;
  } catch { /* esbuild not available — use fallback */ }

  if (!esbuildBuild) {
    return bundleIslandLibFallback(nexusLibDir, libOutDir, usageMap);
  }

  const build    = esbuildBuild;
  const manifest = new Map<string, string>();

  const tasks = [...usageMap.entries()].map(async ([canon, usage]): Promise<boolean> => {
    const actualFile = resolveInNexusLib(nexusLibDir, canon);
    if (!actualFile) return false;

    const syntheticEntry = buildSyntheticEntry(actualFile, usage);
    if (!syntheticEntry) return false;

    // Use a deterministic outfile path for esbuild to name the .map file.
    // We use write:false to capture content before writing hashed filenames.
    const tmpOutPath = join(libOutDir, canon);
    await mkdir(dirname(tmpOutPath), { recursive: true });

    let outputFiles: import('esbuild').OutputFile[];
    try {
      const result = await build({
        stdin: {
          contents: syntheticEntry,
          resolveDir: dirname(actualFile),
          loader: 'js',
        },
        bundle: true,
        treeShaking: true,
        minify: true,
        sourcemap: true,
        format: 'esm',
        outfile: tmpOutPath,
        write: false,
        plugins: [
          {
            name: 'nexus-lib-resolver',
            setup(b) {
              b.onResolve({ filter: /^\$lib\// }, args => {
                const rel      = args.path.slice('$lib/'.length);
                const resolved = resolveInNexusLib(nexusLibDir, rel);
                return resolved
                  ? { path: resolved }
                  : { path: args.path, external: true };
              });
              b.onResolve({ filter: /^\/_nexus\// }, args => ({
                path: args.path,
                external: true,
              }));
            },
          },
        ],
      });
      outputFiles = result.outputFiles;
    } catch {
      return false;
    }

    const jsFile  = outputFiles.find(f => !f.path.endsWith('.map'));
    const mapFile = outputFiles.find(f => f.path.endsWith('.map'));
    if (!jsFile) return false;

    // Hash the JS content to produce the versioned filename.
    const hash       = contentHash(jsFile.text);
    const hashedCanon = insertHash(canon, hash);
    const hashedPath  = join(libOutDir, hashedCanon);

    // Fix the sourceMappingURL comment: `date.js.map` → `date.<hash>.js.map`.
    const jsText = jsFile.text.replace(
      /\/\/# sourceMappingURL=.+$/mu,
      `//# sourceMappingURL=${basename(hashedCanon)}.map`,
    );

    await writeFile(hashedPath, jsText, 'utf-8');

    if (mapFile) {
      // Update the `"file"` field inside the source map JSON.
      let mapText = mapFile.text;
      try {
        const mapJson = JSON.parse(mapText) as { file?: string };
        mapJson.file = basename(hashedCanon);
        mapText = JSON.stringify(mapJson);
      } catch { /* leave unchanged if not valid JSON */ }
      await writeFile(`${hashedPath}.map`, mapText, 'utf-8');
    }

    manifest.set(canon, hashedCanon);
    return true;
  });

  const results = await Promise.all(tasks);
  return { files: results.filter(Boolean).length, manifest };
}

// ─── Fallback (no esbuild) ────────────────────────────────────────────────────

async function bundleIslandLibFallback(
  nexusLibDir: string,
  libOutDir: string,
  usageMap: Map<string, LibUsage>,
): Promise<BundleIslandLibResult> {
  const { readFile } = await import('node:fs/promises');
  const { resolve }  = await import('node:path');

  const TRANSITIVE_RE = /from\s*['"](\$lib\/[^'"]+|\.\.?\/[^'"]+)['"]/gu;
  const queue         = [...usageMap.keys()];
  const visited       = new Set(queue);
  const manifest      = new Map<string, string>();
  let   written       = 0;

  while (queue.length > 0) {
    const canon   = queue.pop()!;
    const srcFile = resolveInNexusLib(nexusLibDir, canon);
    if (!srcFile) continue;

    const raw     = await readFile(srcFile, 'utf-8');
    const fileDir = dirname(srcFile);

    const rewritten = raw.replace(TRANSITIVE_RE, (full, spec: string) => {
      let targetFile: string | null = null;
      if (spec.startsWith('$lib/')) {
        targetFile = resolveInNexusLib(nexusLibDir, spec.slice('$lib/'.length));
      } else {
        const abs    = resolve(fileDir, spec);
        const relAbs = relative(nexusLibDir, abs);
        if (!relAbs.startsWith('..')) targetFile = resolveInNexusLib(nexusLibDir, relAbs);
      }
      if (!targetFile) return full;
      const depCanon = canonicalRel(nexusLibDir, targetFile);
      if (!visited.has(depCanon)) { visited.add(depCanon); queue.push(depCanon); }
      return `from "${LIB_URL_PREFIX}${depCanon}"`;
    });

    const hash        = contentHash(rewritten);
    const hashedCanon = insertHash(canon, hash);
    const outPath     = join(libOutDir, hashedCanon);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten, 'utf-8');
    manifest.set(canon, hashedCanon);
    written++;
  }

  return { files: written, manifest };
}
