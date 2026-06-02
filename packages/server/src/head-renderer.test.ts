import { describe, it, expect, beforeEach } from 'vitest';
import { defineHead, flushHead, renderHeadToString } from '@nexus_js/head';
import type { NexusContext } from './context.js';

// Minimal mock context with head stack
function makeCtx(): NexusContext & { __nexusHeadStack?: any[] } {
  return {
    request: new Request('http://example.com/'),
    params: {},
    url: new URL('http://example.com/'),
    headers: new Headers(),
    locals: {},
    secrets: new Map(),
    cspNonce: '',
    setHeader: () => {},
    setCookie: () => {},
    getCookie: () => undefined,
    redirect: (() => { throw new Error('redirect'); }) as any,
    notFound: (() => { throw new Error('notfound'); }) as any,
    __nexusHeadStack: [],
  } as any;
}

describe('SEO/Metadata head integration (renderer path)', () => {
  beforeEach(() => {
    // ensure clean global (though we prefer ctx)
    flushHead();
  });

  it('defineHead with ctx stores per-request (isolated)', () => {
    const ctx1 = makeCtx();
    const ctx2 = makeCtx();

    defineHead({ title: 'Page One' }, ctx1);
    defineHead({ title: 'Page Two' }, ctx2);

    const flushed1 = flushHead(ctx1);
    const flushed2 = flushHead(ctx2);

    expect(flushed1).toHaveLength(1);
    expect(flushed1[0]!.title).toBe('Page One');
    expect(flushed2).toHaveLength(1);
    expect(flushed2[0]!.title).toBe('Page Two');
  });

  it('flushHead clears the stack for that ctx', () => {
    const ctx = makeCtx();
    defineHead({ title: 'Once' }, ctx);
    const first = flushHead(ctx);
    const second = flushHead(ctx);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('renderHeadToString produces safe <title> and og tags with escaping', () => {
    const metas = [
      { title: 'Hello <World>', description: 'A "test" & more' },
      { og: { image: 'https://ex.com/img.png?x=1&y=2' } },
    ];
    const html = renderHeadToString(metas);
    expect(html).toContain('Hello &lt;World>'); // < escaped to &lt;, > left as-is (perfectly valid)
    expect(html).toContain('og:title');
    expect(html).toContain('og:image');
    expect(html).not.toContain('<World>'); // XSS prevented
    expect(html).toContain('&amp;'); // description escaped
  });

  it('head from load() result shape is what the renderer expects (smoke)', () => {
    // Simulates what mergeRoutePretext does
    const ctx = makeCtx();
    const loadResult = {
      title: 'from pretext',
      head: { title: 'From load head', description: 'SEO rocks' },
    };

    // The actual interception code (copied logic for test)
    if (loadResult && typeof loadResult === 'object' && 'head' in loadResult) {
      const h = (loadResult as any).head;
      if (h) defineHead(h, ctx);
      delete (loadResult as any).head;
    }

    expect('head' in loadResult).toBe(false); // removed before pretext merge
    const flushed = flushHead(ctx);
    expect(flushed[0]?.title).toBe('From load head');
    expect(flushed[0]?.description).toBe('SEO rocks');
  });
});
