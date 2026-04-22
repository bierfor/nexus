import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyLibManifestToClientCode, bundleIslandLib } from './bundle-island-lib.js';

describe('applyLibManifestToClientCode', () => {
  it('rewrites from, import(), and side-effect import to hashed /_nexus/lib URLs', () => {
    const manifest = new Map<string, string>([
      ['a.js', 'a.01020304.js'],
    ]);
    const src = `
import { x } from '/_nexus/lib/a.js';
import('/_nexus/lib/a.js');
import '/_nexus/lib/a.js';
`;
    const out = applyLibManifestToClientCode(src, manifest);
    expect(out).toContain('from "/_nexus/lib/a.01020304.js"');
    expect(out).toContain('import("/_nexus/lib/a.01020304.js")');
    expect(out).toContain('import "/_nexus/lib/a.01020304.js"');
  });
});

describe('bundleIslandLib (integration)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nexus-bil-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('discovers transitive $lib/relative deps and rewrites unhashed /_nexus/lib refs in per-chunk output', async () => {
    const nexusLib = join(root, '.nexus', 'lib');
    const outDir   = join(root, '.nexus', 'output');
    await mkdir(nexusLib, { recursive: true });

    await writeFile(
      join(nexusLib, 'dep.js'),
      'export const z = 1;\n',
      'utf-8',
    );
    await writeFile(
      join(nexusLib, 'entry.js'),
      "import { z } from '/_nexus/lib/dep.js';\nexport const a = z;\n",
      'utf-8',
    );

    const island = "import { a } from '/_nexus/lib/entry.js';\nconsole.log(a);\n";

    const { manifest, files } = await bundleIslandLib(root, outDir, [island]);
    expect(files).toBeGreaterThanOrEqual(2);
    expect(manifest.has('dep.js')).toBe(true);
    expect(manifest.has('entry.js')).toBe(true);

    const entryHashed = manifest.get('entry.js');
    const depHashed   = manifest.get('dep.js');
    expect(entryHashed).toBeDefined();
    expect(depHashed).toBeDefined();

    const entryPath = join(outDir, 'lib', entryHashed!);
    const text      = await readFile(entryPath, 'utf-8');
    // Post-pass: internal ref to dep must use the hashed dep filename, not raw dep.js
    expect(text).toContain(`/_nexus/lib/${depHashed ?? ''}`);
    expect(text).not.toMatch(/['"]\/_nexus\/lib\/dep\.js['"]/);
  });

  it('does not attribute /_nexus/rt/island.js bindings to a $lib file (0.9.11 collectLibUsage)', async () => {
    const nexusLib = join(root, '.nexus', 'lib');
    const outDir   = join(root, '.nexus', 'output');
    await mkdir(nexusLib, { recursive: true });
    await writeFile(
      join(nexusLib, 'auth-client.js'),
      'export const AUTH_KEY = 1; export const readStoredAuth = () => null; export const AUTH_CHANGED = "e";\n',
      'utf-8',
    );
    const island = `import { createIsland, $state, $derived, $effect, $pretext } from '/_nexus/rt/island.js';
import { readStoredAuth, AUTH_KEY } from '/_nexus/lib/auth-client.js';
export function mount() { return 0; }
`;
    const { files } = await bundleIslandLib(root, outDir, [island]);
    expect(files).toBe(1);
  });
});
