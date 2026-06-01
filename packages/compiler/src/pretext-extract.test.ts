import { describe, expect, it } from 'vitest';
import { splitPretext, transformPretextExport } from './pretext-extract.js';

describe('splitPretext', () => {
  it('returns full frontmatter as server when no marker and no load', () => {
    const fm = `import { x } from 'y';\nconst a = 1;`;
    const r = splitPretext(fm);
    expect(r.pretext).toBeNull();
    expect(r.server).toBe(fm);
    expect(r.leading).toBe('');
  });

  it('auto-detects plain load export as pretext (no marker required)', () => {
    const fm = `import { db } from './db';
export async function load(ctx) {
  return { flow: await db.flows.findFirst() };
}`;
    const r = splitPretext(fm);
    expect(r.leading.trim()).toContain("import { db }");
    expect(r.pretext).toContain('export async function load');
    expect(r.pretext).not.toContain('nexus:pretext');
    expect(r.server).toBe('');
  });

  it('splits pretext and server regions', () => {
    const fm = `import { db } from './db';
// nexus:pretext
export async function load(ctx) {
  return { ok: true };
}
// nexus:server
defineHead({ title: 't' });`;
    const r = splitPretext(fm);
    expect(r.leading.trim()).toContain("import { db }");
    expect(r.pretext).toContain('export async function load');
    expect(r.pretext).not.toContain('defineHead');
    expect(r.server.trim()).toContain('defineHead');
  });
});

describe('transformPretextExport', () => {
  it('renames load to nxPretext', () => {
    const out = transformPretextExport('export async function load(ctx) {\n  return {};\n}');
    expect(out).toContain('export async function nxPretext(');
    expect(out).not.toContain('function load(');
  });
});
