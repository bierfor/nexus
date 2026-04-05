/**
 * Copies `my-nexus-app/` route templates into packages/cli/src/create.ts `buildFullScaffoldFiles` only.
 * (The `minimal` template is edited inline in create.ts — not synced from my-nexus-app.)
 *
 * `my-nexus-app` is gitignored in the OSS repo; clone or recreate it locally to run this script.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const app = join(repoRoot, 'my-nexus-app');
const createPath = join(repoRoot, 'packages/cli/src/create.ts');

if (!existsSync(app)) {
  console.error(
    '[sync-scaffold] Missing my-nexus-app/ at repo root. Add that folder locally (gitignored) to sync routes into create.ts.',
  );
  process.exit(1);
}

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function replaceBetween(c, start, endMarker, newInner) {
  const i0 = c.indexOf(start);
  const i1 = c.indexOf(endMarker, i0);
  if (i0 === -1 || i1 === -1) {
    throw new Error(`Missing bounds for ${start.slice(0, 40)}…`);
  }
  return c.slice(0, i0) + start + esc(newInner) + endMarker + c.slice(i1 + endMarker.length);
}

let c = readFileSync(createPath, 'utf8');

c = replaceBetween(
  c,
  `    'src/routes/+layout.nx': \``,
  `\`,\n\n    'src/routes/+page.nx':`,
  readFileSync(join(app, 'src/routes/+layout.nx'), 'utf8'),
);

c = replaceBetween(
  c,
  `    'src/routes/+page.nx': \``,
  `\`,\n\n    'src/routes/islands/+page.nx':`,
  readFileSync(join(app, 'src/routes/+page.nx'), 'utf8'),
);

c = replaceBetween(
  c,
  `    'src/routes/islands/+page.nx': \``,
  `\`,\n\n    'src/routes/blog/+page.nx':`,
  readFileSync(join(app, 'src/routes/islands/+page.nx'), 'utf8'),
);

c = replaceBetween(
  c,
  `    'src/routes/blog/+page.nx': \``,
  `\`,\n\n    'src/routes/blog/[slug]/+page.nx':`,
  readFileSync(join(app, 'src/routes/blog/+page.nx'), 'utf8'),
);

c = replaceBetween(
  c,
  `    'src/routes/blog/[slug]/+page.nx': \``,
  `\`,\n\n    'src/lib/db.ts':`,
  readFileSync(join(app, 'src/routes/blog/[slug]/+page.nx'), 'utf8'),
);

writeFileSync(createPath, c);
console.log('synced +layout.nx, +page.nx, islands, blog routes into create.ts');
