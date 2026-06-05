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

  it('throws on unclosed island tags', () => {
    const t = `<div client:load><span>hi</span>`;
    expect(() => wrapSelfClientIslandMarkers(t, '/app/src/routes/+page.nx', '/app')).toThrow(
      /Unclosed island tag/,
    );
  });

  it('handles manual <nexus-island src="$lib/…"> as external island', () => {
    const t = `<nexus-island client:load src="$lib/islands/menu.ts"><button>Menu</button></nexus-island>`;
    const r = wrapSelfClientIslandMarkers(t, '/app/src/routes/+page.nx', '/app');
    expect(r.didWrap).toBe(true);
    expect(r.template).toContain('data-nexus-component="/_nexus/external-island?path=src%2Flib%2Fislands%2Fmenu.ts"');
    expect(r.template).toContain('data-nexus-island-index="0"');
    expect(r.template).toContain('data-nexus-strategy="client:load"');
    expect(r.template).not.toMatch(/<nexus-island[^>]*\sclient:load/);
    expect(r.template).not.toContain('src=');
    expect(r.template).toContain('<button>Menu</button>');
    expect(r.clientFragments[0]).toBe(''); // placeholder for index alignment
  });

  it('rejects external island src with unsupported prefix', () => {
    const t = `<nexus-island client:load src="http://example.com/menu.ts"></nexus-island>`;
    expect(() => wrapSelfClientIslandMarkers(t, '/app/src/routes/+page.nx', '/app')).toThrow(
      /External island src must start with/,
    );
  });
});
