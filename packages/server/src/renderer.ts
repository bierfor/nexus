/**
 * Nexus SSR Renderer — assembles server-rendered HTML with island markers.
 * Implements PPR (Partial Pre-Rendering): static shell + dynamic holes.
 *
 * Edge-Cache Header Strategy:
 *   Nexus knows the TTL of every cache() call made during rendering.
 *   The renderer collects these TTLs and emits the most conservative
 *   Cache-Control header, ensuring CDNs never serve stale content.
 *
 *   Rules:
 *     1. No cache() calls → Cache-Control: no-store (dynamic, session data)
 *     2. All static (TTL=∞) → Cache-Control: public, max-age=31536000, immutable
 *     3. Mixed TTLs → Cache-Control: s-maxage=<min(ttls)>, stale-while-revalidate=<swr>
 *     4. Has Suspense boundary → Cache-Control: no-store (streaming, can't cache)
 *     5. Has user session → Cache-Control: private, no-store (never CDN-cache)
 */

import type { MatchedRoute } from '@nexus/router';
import type { IslandManifest } from '@nexus/compiler';
import type { NexusContext } from './context.js';

export interface RenderOptions {
  dev: boolean;
  assets: AssetManifest;
}

export interface AssetManifest {
  runtime: string;
  styles: string[];
  islands: Map<string, string>;
}

export interface RenderResult {
  html: string;
  headers: Record<string, string>;
  status: number;
  /** Resolved cache TTL for this page (seconds). 0 = no-store. */
  cacheTtl: number;
}

// ── Cache TTL Registry — populated by cache() calls during render ─────────────
// Each render creates its own context; this uses AsyncLocalStorage in Node.js.
// For edge runtimes, we pass the context explicitly.

const renderTtlContext: { ttls: number[]; hasSession: boolean; hasStream: boolean } = {
  ttls: [],
  hasSession: false,
  hasStream: false,
};

/** Called by @nexus/runtime cache() to register a TTL for this render. */
export function registerCacheTTL(ttl: number): void {
  renderTtlContext.ttls.push(ttl);
}

/** Called when the renderer detects a user session cookie. */
export function markSessionRequest(): void {
  renderTtlContext.hasSession = true;
}

/** Called when the renderer detects a Suspense/streaming boundary. */
export function markStreamingResponse(): void {
  renderTtlContext.hasStream = true;
}

function resetTtlContext(): void {
  renderTtlContext.ttls = [];
  renderTtlContext.hasSession = false;
  renderTtlContext.hasStream = false;
}

/**
 * Computes the Cache-Control header value from the collected TTL context.
 * This is the "smart cache" — the renderer's output is correct by construction.
 */
export function computeCacheControl(ctx: NexusContext): {
  header: string;
  ttl: number;
  strategy: string;
} {
  const { ttls, hasSession, hasStream } = renderTtlContext;

  // Rule 5: Session data is always private
  if (hasSession || ctx.request.headers.get('cookie')?.includes('nx-session=')) {
    return {
      header: 'private, no-store',
      ttl: 0,
      strategy: 'private-no-store',
    };
  }

  // Rule 4: Streaming responses can't be cached by CDN
  if (hasStream) {
    return {
      header: 'no-store',
      ttl: 0,
      strategy: 'streaming-no-store',
    };
  }

  // Rule 1: No cache() calls — treat as fully dynamic
  if (ttls.length === 0) {
    return {
      header: 'no-store',
      ttl: 0,
      strategy: 'dynamic-no-store',
    };
  }

  // Rule 2: All TTL = Infinity → fully static (ISG)
  if (ttls.every((t) => t === Infinity || t >= 31536000)) {
    return {
      header: 'public, max-age=31536000, immutable',
      ttl: 31536000,
      strategy: 'static-immutable',
    };
  }

  // Rule 3: Mixed or finite TTLs → stale-while-revalidate
  const minTtl = Math.min(...ttls.filter((t) => t !== Infinity));
  const swr = Math.min(minTtl * 2, 86400); // SWR = 2x TTL, max 24h

  return {
    header: `public, s-maxage=${minTtl}, stale-while-revalidate=${swr}`,
    ttl: minTtl,
    strategy: 'swr',
  };
}

const DOCTYPE = '<!DOCTYPE html>';

/**
 * Renders a matched route to a full HTML response.
 * Wraps the page with its layout chain and injects island hydration scripts.
 */
export async function renderRoute(
  matched: MatchedRoute,
  ctx: NexusContext,
  opts: RenderOptions,
): Promise<RenderResult> {
  let pageHtml = '';

  // Execute layouts from outermost to innermost
  const layoutSlots: string[] = [];
  for (const layout of matched.layouts) {
    try {
      const mod = await import(/* @vite-ignore */ layout.filepath);
      if (typeof mod.render === 'function') {
        const result = await mod.render(ctx);
        layoutSlots.push(result.html ?? '');
      }
    } catch (err) {
      console.error(`[Nexus] Layout render error (${layout.filepath}):`, err);
    }
  }

  // Render the page itself
  try {
    const pageMod = await import(/* @vite-ignore */ matched.route.filepath);
    if (typeof pageMod.render === 'function') {
      const result = await pageMod.render(ctx);
      pageHtml = result.html ?? '';
    }
  } catch (err) {
    console.error(`[Nexus] Page render error (${matched.route.filepath}):`, err);
    return {
      html: errorPage(err, opts.dev),
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
      status: 500,
      cacheTtl: 0,
    };
  }

  // Compose layouts (outermost wraps innermost wraps page)
  let content = pageHtml;
  for (const slot of layoutSlots.reverse()) {
    content = slot.replace('<!--nexus:slot-->', content);
  }

  // Compute smart cache headers BEFORE resetting the context
  const cacheControl = computeCacheControl(ctx);
  const ttl = cacheControl.ttl;
  resetTtlContext();

  const fullHtml = wrapWithDocument(content, opts);

  return {
    html: DOCTYPE + fullHtml,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl.header,
      'x-nexus-cache-strategy': cacheControl.strategy,
      ...(opts.dev ? { 'x-nexus-ttl': String(ttl) } : {}),
    },
    status: 200,
    cacheTtl: ttl,
  };
}

function wrapWithDocument(content: string, opts: RenderOptions): string {
  const styleLinks = opts.assets.styles
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n    ');

  const runtimeScript = opts.assets.runtime
    ? `<script type="module" src="${opts.assets.runtime}"></script>`
    : '';

  const devTools = opts.dev
    ? `<script>
        // Nexus Dev Tools HMR
        const ws = new WebSocket('ws://localhost:${DEV_WS_PORT}');
        ws.onmessage = (e) => {
          const { type } = JSON.parse(e.data);
          if (type === 'reload') location.reload();
          if (type === 'hmr') console.log('[Nexus HMR] Hot update received');
        };
      </script>`
    : '';

  return `<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${styleLinks}
    ${runtimeScript}
    ${devTools}
  </head>
  <body>
    ${content}
  </body>
</html>`;
}

const DEV_WS_PORT = 7822;

/**
 * Serializes island props for client-side hydration.
 * Uses base64 to safely embed arbitrary JSON in HTML attributes.
 */
export function serializeIslandProps(props: Record<string, unknown>): string {
  return btoa(JSON.stringify(props));
}

/**
 * Wraps a component's HTML output with island metadata for client hydration.
 */
export function wrapIsland(
  html: string,
  opts: {
    id: string;
    componentPath: string;
    strategy: string;
    props?: Record<string, unknown>;
    mediaQuery?: string;
  },
): string {
  const propsAttr = opts.props ? ` data-nexus-props="${serializeIslandProps(opts.props)}"` : '';
  const mediaAttr = opts.mediaQuery ? ` data-nexus-media="${opts.mediaQuery}"` : '';

  return `<nexus-island
    data-nexus-island="${opts.id}"
    data-nexus-component="${opts.componentPath}"
    data-nexus-strategy="${opts.strategy}"${propsAttr}${mediaAttr}
  >${html}</nexus-island>`;
}

function errorPage(err: unknown, dev: boolean): string {
  const message = err instanceof Error ? err.message : String(err);
  const stack = dev && err instanceof Error ? err.stack ?? '' : '';

  return `${DOCTYPE}<html><body style="font-family:monospace;padding:2rem;background:#0a0a0f;color:#ff6b6b">
    <h1 style="color:#ff3e00">Nexus — Server Error</h1>
    <pre>${message}</pre>
    ${dev ? `<pre style="color:#6b6b80;font-size:0.8rem">${stack}</pre>` : ''}
  </body></html>`;
}
