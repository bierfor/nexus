import { describe, expect, it } from 'vitest';
import { wrapSelfClientIslandMarkers } from './island-wrap.js';

describe('wrapSelfClientIslandMarkers', () => {
  it('wraps self-closing client components (/>) in nexus-island', () => {
    const t = `<QrStudio client:load publicOrigin="http://x" />\n<p>x</p>`;
    const r = wrapSelfClientIslandMarkers(t, '/app/src/routes/+page.nx', '/app');
    expect(r.didWrap).toBe(true);
    expect(r.template).toContain('<nexus-island');
    expect(r.template).toContain('data-nexus-island-index="0"');
    expect(r.template).toContain('<QrStudio publicOrigin="http://x"></QrStudio>');
    expect(r.template).not.toContain('<QrStudio client:load');
    expect(r.clientFragments[0]).toContain('</QrStudio>');
  });

  it('still wraps paired tags with inner markup', () => {
    const t = `<div client:load><span>hi</span></div>`;
    const r = wrapSelfClientIslandMarkers(t, '/app/src/routes/+page.nx', '/app');
    expect(r.didWrap).toBe(true);
    expect(r.template).toContain('<nexus-island');
    expect(r.clientFragments[0]).toContain('<span>hi</span>');
  });
});
