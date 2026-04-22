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
 * 3. applyLibManifestToClientCode() rewrites `/_nexus/lib/…` specifiers in route
 *    `.client.js` files and in the emitted `output/lib/*.js` bundles (cross-chunk
 *    imports must use the same content-hashed filenames as the manifest).
 *
 * Tree-shaking strategy
 * ─────────────────────
 * esbuild `build()` is run once per lib file with a synthetic re-export entry
 * that names only the symbols actually imported by islands.  Unused exports and
 * dead internal helpers are eliminated before hashing.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve as pathResolve } from 'node:path';

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

/**
 * `import` … `from '…$lib…'` in generated island code must be resolved **per
 * import statement**. A single regex like
 * `import([\\s\\S]*?)from '…lib…'` can span from the *first* `import` on the
 * file to the *last* `from` before `/_nexus/lib/`, accidentally swallowing
 * the island runtime import (`import { createIsland, … } from
 * '/_nexus/rt/island.js'`) and attributing `createIsland` to `auth-client.js`.
 * We anchor each $lib `from` to the nearest preceding statement and take only
 * the binding that belongs to a real `import` (not `export … from`).
 */
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

  function addClauseToUsage(usage: LibUsage, clause: string): void {
    if (clause.includes('*')) {
      usage.hasNamespace = true;
      return;
    }

    const braceMatch = /\{([^}]*)\}/.exec(clause);
    if (braceMatch) {
      const body = braceMatch[1];
      if (body) {
        for (const part of body.split(',')) {
          const trimmed = part.trim();
          if (!trimmed || trimmed.startsWith('type ')) continue;
          const first = trimmed.split(/\s+as\s+/u)[0];
          const name = first ? first.trim() : '';
          if (name && /^[a-zA-Z_$]/.test(name)) usage.named.add(name);
        }
      }
    }

    const beforeBrace = clause.replace(/\{[^}]*\}/u, '').trim();
    if (beforeBrace && /^[a-zA-Z_$][\w$]*$/.test(beforeBrace)) usage.hasDefault = true;
  }

  for (const code of codes) {
    // Every `from` that loads `/_nexus/lib/…` (string may be in static import or
    // re-export — we only keep real `import` statements for island client code).
    const fromRe = /from\s*['"]\/_nexus\/lib\/[^'"]+['"]/g;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(code)) !== null) {
      const fromIdx = m.index;
      const mUrl    = m[0].match(/['"](\/_nexus\/lib\/[^'"]+)['"]/u);
      const spec    = mUrl?.[1];
      if (!spec) continue;

      const semi  = code.lastIndexOf(';', fromIdx);
      const stmt0 = semi < 0 ? 0 : semi + 1;
      const preFrom = code.slice(stmt0, fromIdx);
      if (!/^\s*import\b/.test(preFrom)) continue;
      if (/^\s*import\s+type\s+/.test(preFrom)) continue;

      const im = /^\s*import\s+([\s\S]+?)\s*$/m.exec(preFrom);
      if (!im) continue;
      const clause = im[1] ?? '';
      // Another `import` or ` from '` inside the binding = straddled a prior
      // `import … from '…'`, e.g. island runtime + $lib in one bogus span.
      if (/\bimport\s/.test(clause)) continue;
      if (/\bfrom\s*['"]/.test(clause)) continue;
      if (clause.includes(';')) continue;

      if (/^type\s/.test(clause.trim())) continue;

      const rel      = spec.slice(LIB_URL_PREFIX.length);
      const resolved = resolveInNexusLib(nexusLibDir, rel);
      if (!resolved) continue;
      const canon = canonicalRel(nexusLibDir, resolved);
      const usage = getOrCreate(canon);
      addClauseToUsage(usage, clause);
    }
  }

  return result;
}

/**
 * BFS: island code only lists direct $lib imports; .nexus/lib files can import
 * other lib modules ($lib/… or relative).  Those modules must be included in
 * the esbuild list (and built with a permissive re-export) or chunk graphs break.
 */
/** `foo.abcd1234.js` -> `foo.js` (content-hashed nexus lib names). */
function stripNexusLibContentHashInPath(rel: string): string {
  return rel
    .replace(/\.[a-f0-9]{8}\.js$/iu, '.js')
    .replace(/\.(ts|tsx|mts)$/u, '.js');
}

function nexusUrlImportToRelative(spec: string): string | null {
  if (spec.startsWith(LIB_URL_PREFIX)) {
    return stripNexusLibContentHashInPath(spec.slice(LIB_URL_PREFIX.length));
  }
  return null;
}

function extractLocalLibSpecifiersFromSource(source: string): string[] {
  const out: string[] = [];
  const reFrom = /\bfrom\s*['"]((?:\$lib\/[^'"]+)|(?:\.\.?\/?[^'"]*))['"]/gu;
  const reExp  = /export\s*(?:\*\s*|\{[^}]*\})\s*from\s*['"]((?:\$lib\/[^'"]+)|(?:\.\.?\/?[^'"]*))['"]/gu;
  const reDyn  = /\bimport\s*\(\s*['"]((?:\$lib\/[^'"]+)|(?:\.\.?\/?[^'"]*))['"]\s*\)/gu;
  const reNex  = /['"]((\/_nexus\/lib\/[^'"]+))['"]/gu; // from / import() / import "" / export … from
  for (const re of [reFrom, reExp, reDyn, reNex]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const s = m[1];
      if (s) {
        if (s.startsWith(LIB_URL_PREFIX)) {
          out.push(nexusUrlImportToRelative(s) ?? s);
        } else {
          out.push(s);
        }
      }
    }
  }
  return [...new Set(out)];
}

function specToCanonicalKey(
  nexusLibDir: string,
  fromDir: string,
  spec: string,
): string | null {
  if (spec.startsWith('$lib/')) {
    const abs = resolveInNexusLib(nexusLibDir, spec.slice(5));
    return abs ? canonicalRel(nexusLibDir, abs) : null;
  }
  if (spec.startsWith('.')) {
    const abs = pathResolve(fromDir, spec);
    const n   = relative(nexusLibDir, abs);
    if (n.startsWith('..') || n === '') return null;
    const nSlash   = n.replace(/\\/g, '/');
    const absProbe = resolveInNexusLib(nexusLibDir, nSlash) ?? resolveInNexusLib(nexusLibDir, nSlash.replace(/\.(ts|tsx|mts|js|mjs)$/u, ''));
    return absProbe ? canonicalRel(nexusLibDir, absProbe) : null;
  }
  if (spec.startsWith(LIB_URL_PREFIX)) {
    const rel = nexusUrlImportToRelative(spec);
    if (!rel) return null;
    const abs = resolveInNexusLib(nexusLibDir, rel);
    return abs ? canonicalRel(nexusLibDir, abs) : null;
  }
  // Strips from `from '/_nexus/lib/foo.js'`, e.g. `auth/client.js`
  {
    const abs = resolveInNexusLib(nexusLibDir, spec);
    return abs ? canonicalRel(nexusLibDir, abs) : null;
  }
}

async function expandLibUsageWithTransitiveDeps(
  nexusLibDir: string,
  initial: ReadonlyMap<string, LibUsage>,
): Promise<Map<string, LibUsage>> {
  const out   = new Map<string, LibUsage>(initial);
  const queue = [...out.keys()];

  while (queue.length > 0) {
    const canon = queue.shift()!;
    const abs   = resolveInNexusLib(nexusLibDir, canon);
    if (!abs) continue;
    let source: string;
    try {
      source = await readFile(abs, 'utf-8');
    } catch {
      continue;
    }
    const fromDir = dirname(abs);
    for (const spec of extractLocalLibSpecifiersFromSource(source)) {
      const key = specToCanonicalKey(nexusLibDir, fromDir, spec);
      if (!key) continue;
      if (out.has(key)) continue;
      out.set(key, { named: new Set(), hasDefault: false, hasNamespace: true });
      queue.push(key);
    }
  }

  return out;
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
 * Rewrite `/_nexus/lib/X.js` → `/_nexus/lib/X.<hash>.js` using the manifest
 * from `bundleIslandLib`.  Covers `from`, `import()`, and side-effect `import ""`.
 * Used for route `.client.js` and for the emitted `output/lib/*.js` chunks so
 * cross-chunk /_nexus/lib URLs match hashed filenames.
 */
export function applyLibManifestToClientCode(
  code: string,
  manifest: ReadonlyMap<string, string>,
): string {
  if (manifest.size === 0) return code;

  const toHashed = (spec: string): string | null => {
    if (!spec.startsWith(LIB_URL_PREFIX)) return null;
    const rel   = spec.slice(LIB_URL_PREFIX.length);
    const jsRel = rel.replace(/\.(ts|tsx|mts)$/u, '.js');
    const hashed = manifest.get(jsRel) ?? manifest.get(`${rel}.js`) ?? manifest.get(rel);
    return hashed ? `${LIB_URL_PREFIX}${hashed}` : null;
  };

  let out = code;
  out = out.replace(
    /from\s*['"](\/_nexus\/lib\/[^'"]+)['"]/gu,
    (full, spec: string) => {
      const h = toHashed(spec);
      return h && h !== spec ? `from ${JSON.stringify(h)}` : full;
    },
  );
  out = out.replace(
    /import\s*\(\s*['"](\/_nexus\/lib\/[^'"]+)['"]\s*\)/gu,
    (full, spec: string) => {
      const h = toHashed(spec);
      return h && h !== spec ? `import(${JSON.stringify(h)})` : full;
    },
  );
  out = out.replace(
    /import\s*['"](\/_nexus\/lib\/[^'"]+)['"]/gu,
    (full, spec: string) => {
      const h = toHashed(spec);
      return h && h !== spec ? `import ${JSON.stringify(h)}` : full;
    },
  );
  return out;
}

async function applyLibManifestToAllLibOutputFiles(
  libOutDir: string,
  manifest: ReadonlyMap<string, string>,
): Promise<void> {
  if (manifest.size === 0) return;

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    const es = await readdir(dir, { withFileTypes: true });
    for (const e of es) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await walk(p)));
      } else if (e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.map')) {
        out.push(p);
      }
    }
    return out;
  }

  const files = await walk(libOutDir);
  for (const f of files) {
    const t   = await readFile(f, 'utf-8');
    const nxt = applyLibManifestToClientCode(t, manifest);
    if (nxt !== t) {
      await writeFile(f, nxt, 'utf-8');
    }
  }
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

  const collected = collectLibUsage(clientCodes, nexusLibDir);
  if (collected.size === 0) return { files: 0, manifest: new Map() };

  const usageMap = await expandLibUsageWithTransitiveDeps(nexusLibDir, collected);

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
  await applyLibManifestToAllLibOutputFiles(libOutDir, manifest);
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

  await applyLibManifestToAllLibOutputFiles(libOutDir, manifest);
  return { files: written, manifest };
}
