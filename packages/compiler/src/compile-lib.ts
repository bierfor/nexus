/**
 * Compile `src/lib/**\/*.ts` → `.nexus/lib/**\/*.js` for production deployment.
 *
 * `nexus build` calls this before writing route server modules so that the
 * absolute `file://…/.nexus/lib/*.js` URLs embedded in those modules resolve at
 * runtime without a TypeScript loader.
 *
 * Uses TypeScript's `transpileModule` (no type-checking, pure syntax transform)
 * so it is fast and needs no tsconfig in the user's project.
 */

import ts from 'typescript';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const TS_SOURCE_RE = /\.(ts|tsx|mts)$/u;

async function walkTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkTsFiles(p)));
    } else if (TS_SOURCE_RE.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Transpile every `.ts` / `.tsx` / `.mts` file under `<appRoot>/src/lib/` to
 * ESM JavaScript and write the output to `<appRoot>/.nexus/lib/`.
 *
 * Returns the number of files compiled.
 */
export async function compileLib(appRoot: string): Promise<{ files: number }> {
  const libDir = join(appRoot, 'src', 'lib');
  if (!existsSync(libDir)) return { files: 0 };

  const outDir = join(appRoot, '.nexus', 'lib');
  await mkdir(outDir, { recursive: true });

  const tsFiles = await walkTsFiles(libDir);
  if (tsFiles.length === 0) return { files: 0 };

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
    useDefineForClassFields: true,
    verbatimModuleSyntax: false,
    // No type-checking — pure syntax transform for speed.
    isolatedModules: true,
    // Don't emit `.d.ts` — these are runtime files only.
    declaration: false,
  };

  for (const tsFile of tsFiles) {
    const source = await readFile(tsFile, 'utf-8');
    const result = ts.transpileModule(source, { compilerOptions });
    const relPath = relative(libDir, tsFile);
    const outPath = join(outDir, relPath.replace(TS_SOURCE_RE, '.js'));
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, result.outputText, 'utf-8');
  }

  return { files: tsFiles.length };
}
