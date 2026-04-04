import { describe, it, expect } from 'vitest';
import { scanIslandSecurity } from './client-security-scan.js';
import type { ParsedComponent } from './types.js';

function minimalParsed(over: Partial<ParsedComponent>): ParsedComponent {
  return {
    source: '',
    filepath: '/app/src/routes/+page.nx',
    frontmatter: null,
    pretext: null,
    script: null,
    template: null,
    style: null,
    islandDirectives: [],
    serverActions: [],
    ...over,
  };
}

describe('scanIslandSecurity', () => {
  it('flags process.env in script', () => {
    const w = scanIslandSecurity(
      minimalParsed({
        script: { type: 'script', content: 'const x = process.env.API_KEY', start: 0, end: 1 },
      }),
    );
    expect(w.some((x) => x.message.includes('process.env'))).toBe(true);
  });

  it('flags inline onclick in template', () => {
    const w = scanIslandSecurity(
      minimalParsed({
        template: { type: 'template', content: '<button onclick="evil()">x</button>', start: 0, end: 1 },
      }),
    );
    expect(w.some((x) => x.message.includes('inline'))).toBe(true);
  });
});
