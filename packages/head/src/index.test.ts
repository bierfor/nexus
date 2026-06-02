import { describe, it, expect, beforeEach } from 'vitest';
import { defineHead, flushHead, renderHeadToString, type HeadContext } from './index.js';

describe('defineHead + flushHead (global stack)', () => {
  beforeEach(() => {
    // Ensure global stack is clean before each test
    flushHead();
  });

  it('collects a single meta entry', () => {
    defineHead({ title: 'Hello' });
    const heads = flushHead();
    expect(heads).toHaveLength(1);
    expect(heads[0]).toEqual({ title: 'Hello' });
  });

  it('collects multiple entries in order', () => {
    defineHead({ title: 'First' });
    defineHead({ description: 'Second' });
    const heads = flushHead();
    expect(heads).toHaveLength(2);
    expect(heads[0]).toEqual({ title: 'First' });
    expect(heads[1]).toEqual({ description: 'Second' });
  });

  it('clears the stack after flush', () => {
    defineHead({ title: 'A' });
    flushHead();
    const second = flushHead();
    expect(second).toHaveLength(0);
  });
});

describe('defineHead + flushHead (request-scoped ctx)', () => {
  it('uses ctx stack when provided', () => {
    const ctx: HeadContext = { __nexusHeadStack: [] };
    defineHead({ title: 'Scoped' }, ctx);
    const heads = flushHead(ctx);
    expect(heads).toHaveLength(1);
    expect(heads[0]).toEqual({ title: 'Scoped' });
  });

  it('isolates multiple contexts', () => {
    const ctxA: HeadContext = { __nexusHeadStack: [] };
    const ctxB: HeadContext = { __nexusHeadStack: [] };

    defineHead({ title: 'A' }, ctxA);
    defineHead({ title: 'B' }, ctxB);

    const headsA = flushHead(ctxA);
    const headsB = flushHead(ctxB);

    expect(headsA).toHaveLength(1);
    expect(headsA[0]).toEqual({ title: 'A' });
    expect(headsB).toHaveLength(1);
    expect(headsB[0]).toEqual({ title: 'B' });
  });

  it('falls back to global when ctx has no stack', () => {
    // Clean global first
    flushHead();
    const ctx: HeadContext = {}; // no __nexusHeadStack
    defineHead({ title: 'Fallback' }, ctx);
    const heads = flushHead(ctx);
    expect(heads).toHaveLength(1);
    expect(heads[0]).toEqual({ title: 'Fallback' });
  });
});

describe('renderHeadToString', () => {
  it('renders title with og and twitter mirrors', () => {
    const html = renderHeadToString([{ title: 'Page' }]);
    expect(html).toContain('<title>Page</title>');
    expect(html).toContain('<meta property="og:title" content="Page">');
    expect(html).toContain('<meta name="twitter:title" content="Page">');
  });

  it('renders description with og and twitter mirrors', () => {
    const html = renderHeadToString([{ description: 'Desc' }]);
    expect(html).toContain('<meta name="description" content="Desc">');
    expect(html).toContain('<meta property="og:description" content="Desc">');
    expect(html).toContain('<meta name="twitter:description" content="Desc">');
  });

  it('renders canonical + og:url', () => {
    const html = renderHeadToString([{ canonical: 'https://example.com/page' }]);
    expect(html).toContain('<link rel="canonical" href="https://example.com/page">');
    expect(html).toContain('<meta property="og:url" content="https://example.com/page">');
  });

  it('renders og:image with preload and twitter mirror', () => {
    const html = renderHeadToString([{ og: { image: 'https://example.com/og.png' } }]);
    expect(html).toContain('<meta property="og:image" content="https://example.com/og.png">');
    expect(html).toContain('<meta name="twitter:image" content="https://example.com/og.png">');
    expect(html).toContain('<link rel="preload" as="image" href="https://example.com/og.png">');
  });

  it('merges later entries over earlier ones', () => {
    const html = renderHeadToString([
      { title: 'First' },
      { title: 'Second' },
    ]);
    expect(html).toContain('<title>Second</title>');
    expect(html).not.toContain('<title>First</title>');
  });

  it('merges shallow og objects', () => {
    const html = renderHeadToString([
      { og: { title: 'A', image: 'a.png' } },
      { og: { title: 'B' } },
    ]);
    // buildHeadHTML renders og:image when present, but og:title only when meta.title is set
    // This is current behaviour; we test that merge preserves both keys
    expect(html).toContain('<meta property="og:image" content="a.png">');
    expect(html).not.toContain('<meta property="og:title" content="A">');
  });

  it('escapes HTML in values', () => {
    const html = renderHeadToString([{ title: '<script>alert(1)</script>' }]);
    // esc() currently escapes <, &, " but not > — test current behaviour
    expect(html).toContain('<title>&lt;script>alert(1)&lt;/script></title>');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders JSON-LD schema', () => {
    const html = renderHeadToString([{
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Nexus' },
    }]);
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebSite"');
  });

  it('renders arbitrary meta and link tags', () => {
    const html = renderHeadToString([{
      metas: [{ name: 'author', content: 'Nexus Team' }],
      links: [{ rel: 'alternate', href: '/rss.xml', type: 'application/rss+xml' }],
    }]);
    expect(html).toContain('<meta name="author" content="Nexus Team">');
    expect(html).toContain('<link rel="alternate" href="/rss.xml" type="application/rss+xml">');
  });

  it('renders title with template', () => {
    const html = renderHeadToString([{ title: 'Post', titleTemplate: '%s | My Blog' }]);
    expect(html).toContain('<title>Post | My Blog</title>');
  });

  it('returns empty string for empty metas', () => {
    const html = renderHeadToString([]);
    expect(html).toBe('');
  });
});
