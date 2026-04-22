import ts from 'typescript';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';

const LIB_PREFIX = '/_nexus/lib/';

function isSafeUnderRoot(root: string, file: string): boolean {
  const rel = relative(root, resolve(file));
  if (rel === '..') return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return true;
}

function isDeniedLibPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  if (norm.includes('/server/')) return true;
  if (norm.endsWith('.server.js')) return true;
  return false;
}

function transpileTsToEsm(source: string): string {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
    useDefineForClassFields: true,
    verbatimModuleSyntax: false,
    isolatedModules: true,
    declaration: false,
  };
  return ts.transpileModule(source, { compilerOptions }).outputText;
}

export async function tryServeLibAsset(
  pathname: string,
  appRoot: string,
  dev: boolean,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!pathname.startsWith(LIB_PREFIX)) return null;
  const rel = pathname.slice(LIB_PREFIX.length);
  if (!rel) return null;
  if (rel.includes('..')) return null;
  if (!/^[\w./-]+\.js$/u.test(rel)) return null;
  if (isDeniedLibPath(rel)) return null;

  const outRoot = resolve(join(appRoot, '.nexus', 'lib'));
  const outFile = resolve(join(outRoot, normalize(rel)));
  if (!isSafeUnderRoot(outRoot, outFile)) return null;

  try {
    const s = await stat(outFile);
    if (!s.isFile()) return null;
    const body = await readFile(outFile);
    return { body, contentType: 'application/javascript; charset=utf-8' };
  } catch {
    /* not found */
  }

  if (!dev) return null;

  const srcRoot = resolve(join(appRoot, 'src', 'lib'));
  const tryFiles = [
    resolve(join(srcRoot, normalize(rel.replace(/\.js$/u, '.ts')))),
    resolve(join(srcRoot, normalize(rel.replace(/\.js$/u, '.tsx')))),
    resolve(join(srcRoot, normalize(rel.replace(/\.js$/u, '.mts')))),
  ];

  for (const f of tryFiles) {
    if (!isSafeUnderRoot(srcRoot, f)) continue;
    if (isDeniedLibPath(relative(srcRoot, f).replace(/\\/g, '/'))) continue;
    if (!existsSync(f)) continue;
    try {
      const s = await stat(f);
      if (!s.isFile()) continue;
      const source = await readFile(f, 'utf-8');
      const js = transpileTsToEsm(source);
      return { body: Buffer.from(js, 'utf-8'), contentType: 'application/javascript; charset=utf-8' };
    } catch {
      continue;
    }
  }

  return null;
}

