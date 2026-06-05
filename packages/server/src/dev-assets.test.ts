import { describe, it, expect } from 'vitest';
import { compileExternalIslandBundle } from './dev-assets.js';

describe('compileExternalIslandBundle', () => {
  it('returns a micro-bundle importing the $lib file', async () => {
    const url = new URL('http://localhost/_nexus/external-island?path=src%2Flib%2Fislands%2Fhello.ts');
    const result = await compileExternalIslandBundle('/Users/bierhffor/nexus/examples/with-islands', url);
    expect(result.status).toBe(200);
    expect(result.body).toContain('import init from "/_nexus/lib/islands/hello.js"');
    expect(result.body).toContain('export function mount(el, props)');
  });

  it('returns 404 for missing source', async () => {
    const url = new URL('http://localhost/_nexus/external-island?path=src%2Flib%2Fmissing.ts');
    const result = await compileExternalIslandBundle('/Users/bierhffor/nexus/examples/with-islands', url);
    expect(result.status).toBe(404);
    expect(result.body).toContain('External island source not found');
  });

  it('returns 400 for invalid path traversal', async () => {
    const url = new URL('http://localhost/_nexus/external-island?path=..%2Fsecret.ts');
    const result = await compileExternalIslandBundle('/Users/bierhffor/nexus/examples/with-islands', url);
    expect(result.status).toBe(400);
  });
});
