import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeRoutePretext, renderRoute, wrapWithDocument } from './renderer.js';
import { flushHead } from '@nexus_js/head';
import type { NexusContext } from './context.js';
import type { MatchedRoute } from '@nexus_js/router';
import type { RenderOptions } from './renderer.js';

vi.mock('./load-module.js', () => ({
  loadRouteModule: vi.fn(),
}));

vi.mock('./devradar.js', () => ({
  emitDevRadar: vi.fn(),
}));

import { loadRouteModule } from './load-module.js';

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
    redirect: (() => {
      throw new Error('redirect');
    }) as any,
    notFound: (() => {
      throw new Error('notfound');
    }) as any,
    __nexusHeadStack: [],
  } as any;
}

function makeOpts(): RenderOptions {
  return {
    dev: false,
    appRoot: '/app',
    assets: {
      runtime: '/_nexus/rt/index.js',
      styles: [],
      islands: new Map(),
    },
  };
}

function makeMatched(overrides?: Partial<MatchedRoute>): MatchedRoute {
  return {
    layouts: [],
    route: {
      filepath: '/app/src/routes/+page.nx',
      pattern: '/',
      params: [],
      isDynamic: false,
      isLayout: false,
      serverActions: [],
    },
    params: {},
    ...overrides,
  } as MatchedRoute;
}

describe('mergeRoutePretext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flushHead();
  });

  it('collects head from load results and deletes it before pretext merge', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => ({
        data: 'value',
        head: { title: 'My Title', description: 'My Desc' },
      }),
    } as any);

    const pretext = await mergeRoutePretext(matched, ctx, makeOpts());

    expect(pretext.data).toBe('value');
    expect('head' in pretext).toBe(false);

    const heads = flushHead(ctx);
    expect(heads).toHaveLength(1);
    expect(heads[0]).toEqual({ title: 'My Title', description: 'My Desc' });
  });

  it('merges layout and page pretext (child wins)', async () => {
    const ctx = makeCtx();
    const matched = makeMatched({
      layouts: [{ filepath: '/app/src/routes/+layout.nx', pattern: '/', params: [], isDynamic: false, isLayout: true, serverActions: [] }],
    });

    vi.mocked(loadRouteModule).mockImplementation(async (filepath) => {
      if (filepath.includes('layout')) {
        return {
          nxPretext: async () => ({ shared: 'layout', layoutOnly: true }),
        } as any;
      }
      return {
        nxPretext: async () => ({ shared: 'page', pageOnly: true }),
      } as any;
    });

    const pretext = await mergeRoutePretext(matched, ctx, makeOpts());
    expect(pretext.shared).toBe('page'); // child wins
    expect(pretext.layoutOnly).toBe(true);
    expect(pretext.pageOnly).toBe(true);
  });

  it('ignores head when it is not a plain object (deletes it without defineHead)', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => ({
        data: 'value',
        head: 'not-an-object',
      }),
    } as any);

    const pretext = await mergeRoutePretext(matched, ctx, makeOpts());
    expect(pretext.data).toBe('value');
    expect('head' in pretext).toBe(false); // deleted regardless
    const heads = flushHead(ctx);
    expect(heads).toHaveLength(0); // not passed to defineHead
  });

  it('handles load() returning a non-object by wrapping it', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => 'plain-string',
    } as any);

    const pretext = await mergeRoutePretext(matched, ctx, makeOpts());
    expect(pretext.value).toBe('plain-string');
  });
});

describe('wrapWithDocument', () => {
  const opts = makeOpts();

  it('replaces <!--nexus:head--> with injection', () => {
    const content =
      '<html><head><!--nexus:head--></head><body>hi</body></html>';
    const html = wrapWithDocument(
      content,
      opts,
      [],
      0,
      null,
      '<title>Test</title>',
    );
    expect(html).toContain('<title>Test</title>');
    expect(html).not.toContain('<!--nexus:head-->');
    expect(html.indexOf('<title>Test</title>')).toBeLessThan(
      html.indexOf('</head>'),
    );
  });

  it('injects before </head> when marker is absent', () => {
    const content =
      '<html><head><meta charset="UTF-8"></head><body>hi</body></html>';
    const html = wrapWithDocument(
      content,
      opts,
      [],
      0,
      null,
      '<title>Test</title>',
    );
    expect(html).toContain('<title>Test</title>');
    expect(html.indexOf('<title>Test</title>')).toBeLessThan(
      html.indexOf('</head>'),
    );
  });

  it('injects after <head> when there is no closing </head>', () => {
    const content = '<html><head><meta charset="UTF-8"></headx><body>hi</body></html>';
    const html = wrapWithDocument(
      content,
      opts,
      [],
      0,
      null,
      '<title>Test</title>',
    );
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('<head>');
  });

  it('wraps fragments in default html shell', () => {
    const content = '<main>hello</main>';
    const html = wrapWithDocument(
      content,
      opts,
      [],
      0,
      null,
      '<title>Test</title>',
    );
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('<main>hello</main>');
  });
});

describe('renderRoute', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flushHead();
  });

  it('renders full HTML with injected head via marker', async () => {
    const ctx = makeCtx();
    const matched = makeMatched({
      layouts: [{ filepath: '/app/src/routes/+layout.nx', pattern: '/', params: [], isDynamic: false, isLayout: true, serverActions: [] }],
    });

    vi.mocked(loadRouteModule).mockImplementation(async (filepath) => {
      if (filepath.includes('layout')) {
        return {
          nxPretext: async () => ({
            layout: true,
            head: { title: 'Layout Title', description: 'Layout Desc' },
          }),
          render: async () => ({
            html: `<html><head><!--nexus:head--></head><body><!--nexus:slot--></body></html>`,
          }),
        } as any;
      }
      return {
        nxPretext: async () => ({
          page: true,
          head: { title: 'Page Title', description: 'Page Desc' },
        }),
        render: async () => ({
          html: `<main>Content</main>`,
        }),
      } as any;
    });

    const result = await renderRoute(matched, ctx, makeOpts());

    expect(result.status).toBe(200);
    expect(result.html).toContain('<!DOCTYPE html>');
    // Child wins on title merge
    expect(result.html).toContain('<title>Page Title</title>');
    expect(result.html).toContain('<meta name="description" content="Page Desc">');
    expect(result.html).toContain('<main>Content</main>');
    expect(result.html).not.toContain('<!--nexus:head-->');
  });

  it('renders full HTML injecting before </head> when no marker', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => ({
        head: { title: 'No Marker', description: 'No Marker Desc' },
      }),
      render: async () => ({
        html: `<html><head><meta charset="UTF-8"></head><body>hello</body></html>`,
      }),
    } as any);

    const result = await renderRoute(matched, ctx, makeOpts());

    expect(result.status).toBe(200);
    expect(result.html).toContain('<title>No Marker</title>');
    expect(result.html.indexOf('<title>No Marker</title>')).toBeLessThan(
      result.html.indexOf('</head>'),
    );
  });

  it('returns 500 when page render throws', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => ({}),
      render: async () => {
        throw new Error('render boom');
      },
    } as any);

    const result = await renderRoute(matched, ctx, makeOpts());

    expect(result.status).toBe(500);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.html).toContain('Something went wrong');
  });

  it('returns 500 when pretext throws', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => {
        throw new Error('pretext boom');
      },
    } as any);

    const result = await renderRoute(matched, ctx, makeOpts());

    expect(result.status).toBe(500);
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('sets cache-control headers based on TTL context', async () => {
    const ctx = makeCtx();
    const matched = makeMatched();

    vi.mocked(loadRouteModule).mockResolvedValue({
      nxPretext: async () => ({}),
      render: async () => ({
        html: `<html><head></head><body>hi</body></html>`,
      }),
    } as any);

    const result = await renderRoute(matched, ctx, makeOpts());

    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-nexus-cache-strategy']).toBe('dynamic-no-store');
  });
});
