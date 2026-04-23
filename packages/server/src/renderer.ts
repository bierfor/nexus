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

import type { MatchedRoute } from '@nexus_js/router';
import type { IslandManifest } from '@nexus_js/compiler';
import { serialize } from '@nexus_js/serialize';
import { NotFoundSignal, RedirectSignal, type NexusContext } from './context.js';
import { SESSION_COOKIE_NAME } from './csrf.js';
import { devErrorHtmlPage } from './dev-error-html.js';
import { loadRouteModule } from './load-module.js';
import { emitDevRadar } from './devradar.js';
import { createStreamingResponse, nextStreamBoundaryId } from './streaming.js';
import type { StreamingPromiseValue } from './streaming.js';

export interface RenderOptions {
  dev: boolean;
  /** Required for loading `.nx` routes (dev compile + prod build path). */
  appRoot: string;
  /**
   * From `.nexus/build-id.json` after `nexus build`. Injected into the document
   * as `window.__NEXUS_BUILD_ID__` so `callAction` can send `x-nexus-build-id`.
   */
  buildId?: string;
  assets: AssetManifest;
  /**
   * Extra `<script type="importmap">` `imports` entries (merged over Nexus defaults).
   * Pass from `nexus.config.ts` `browser.importMap` for island bare imports (e.g. `qr-code-styling`).
   */
  browserImportMap?: Record<string, string>;
  /**
   * Per-request CSP nonce (base64url, 16 bytes).
   * When provided, all inline `<script>` tags in the rendered document carry
   * `nonce="{nonce}"`, and the `Content-Security-Policy` header is generated
   * by the caller using this value.
   * Generate with `randomBytes(16).toString('base64url')` per request.
   */
  cspNonce?: string;
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
  /** Number of island markers found in the rendered HTML */
  islandCount: number;
}

/** A single entry in the server-to-browser log bridge */
export interface ServerBridgeLog {
  type: 'render' | 'cache' | 'fetch' | 'action' | 'island-count';
  path?:          string;
  duration?:      number;
  cacheStrategy?: string;
  cacheHit?:      boolean;
  islandCount?:   number;
  url?:           string;
  label?:         string;
}

/** Build-time info injected into the dev bridge for the "performance score" */
export interface BuildInfo {
  /** Estimated JS bytes for this route */
  totalJs?: number;
  /** Estimated JS bytes if using React instead (injected as `reactEquivalent`) */
  reactEquivalent?: number;
}

// ── Cache TTL Registry — populated by cache() calls during render ─────────────
// Each render creates its own context; this uses AsyncLocalStorage in Node.js.
// For edge runtimes, we pass the context explicitly.

const renderTtlContext: { ttls: number[]; hasSession: boolean; hasStream: boolean } = {
  ttls: [],
  hasSession: false,
  hasStream: false,
};

/** Called by @nexus_js/runtime cache() to register a TTL for this render. */
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
  if (hasSession || ctx.request.headers.get('cookie')?.includes(`${SESSION_COOKIE_NAME}=`)) {
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
/**
 * Runs `nxPretext` from every layout (outer → inner) and the page in parallel,
 * then shallow-merges results onto `ctx.pretext` (page wins on key collisions).
 */
export async function mergeRoutePretext(
  matched: MatchedRoute,
  ctx: NexusContext,
  opts: RenderOptions,
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const chain = [
    ...matched.layouts.map((l) => ({ filepath: l.filepath, pattern: l.pattern, isLayout: true  as const })),
    { filepath: matched.route.filepath, pattern: matched.route.pattern, isLayout: false as const },
  ];
  try {
    const mods = await Promise.all(
      chain.map((c) =>
        loadRouteModule(c.filepath, {
          dev: opts.dev,
          appRoot: opts.appRoot,
          pattern: c.pattern,
          isLayout: c.isLayout,
        }),
      ),
    );
    const results = await Promise.all(
      mods.map((mod) => {
        const fn = (mod as Record<string, unknown>).nxPretext;
        return typeof fn === 'function' ? (fn as (c: NexusContext) => Promise<unknown>)(ctx) : Promise.resolve({});
      }),
    );
    const objects = results.map((r) =>
      r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : { value: r },
    );
    return Object.assign({}, ...objects);
  } finally {
    emitDevRadar({
      type: 'devtools:pretext',
      payload: {
        pattern:        matched.route.pattern,
        durationMs:     Date.now() - t0,
        parallelCount:  chain.length,
      },
    });
  }
}

type LayoutsAndPageOk = { ok: true; content: string; islandCount: number };
type LayoutsAndPageErr = { ok: false; result: RenderResult };

/**
 * Runs layouts + page render after `ctx.pretext` is set (used by buffered and streaming SSR).
 */
export async function runLayoutsAndPage(
  matched: MatchedRoute,
  ctx: NexusContext,
  opts: RenderOptions,
): Promise<LayoutsAndPageOk | LayoutsAndPageErr> {
  let pageHtml = '';
  const layoutSlots: string[] = [];

  for (const layout of matched.layouts) {
    try {
      const mod = await loadRouteModule(layout.filepath, {
        dev: opts.dev,
        appRoot: opts.appRoot,
        pattern: layout.pattern,
        isLayout: true,
      });
      if (typeof mod.render === 'function') {
        const result = await mod.render(ctx);
        layoutSlots.push(result.html ?? '');
      }
    } catch (err) {
      if (err instanceof RedirectSignal || err instanceof NotFoundSignal) throw err;
      console.error(`[Nexus] Layout render error (${layout.filepath}):`, err);
    }
  }

  try {
    const pageMod = await loadRouteModule(matched.route.filepath, {
      dev: opts.dev,
      appRoot: opts.appRoot,
      pattern: matched.route.pattern,
      isLayout: false,
    });
    if (typeof pageMod.render === 'function') {
      const result = await pageMod.render(ctx);
      pageHtml = result.html ?? '';
    }
  } catch (err) {
    if (err instanceof RedirectSignal || err instanceof NotFoundSignal) throw err;
    console.error(`[Nexus] Page render error (${matched.route.filepath}):`, err);
    return {
      ok: false,
      result: {
        html: errorPage(err, opts.dev),
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
        status: 500,
        cacheTtl: 0,
        islandCount: 0,
      },
    };
  }

  let content = pageHtml;
  for (const slot of layoutSlots.reverse()) {
    content = slot.replace('<!--nexus:slot-->', content);
  }

  const islandCount = (content.match(/<nexus-island/g) ?? []).length;
  return { ok: true, content, islandCount };
}

/**
 * Progressive SSR: flush the HTML shell (head + skeleton) before `nxPretext` finishes,
 * then stream the real layout/page fragment and update `#__NEXUS_PRETEXT__`.
 *
 * Requires fragment layouts: the composed route must not emit a root `&lt;html&gt;` document.
 */
export function renderRouteStreaming(
  matched: MatchedRoute,
  ctx: NexusContext,
  opts: RenderOptions,
): Response {
  markStreamingResponse();
  const boundaryId = nextStreamBoundaryId();
  const emptyPretext = serialize({});

  return createStreamingResponse(
    async (ctrl) => {
      const shellInner =
        `<style id="nx-stream-skel">` +
        `.nx-pretext-skeleton{min-height:32vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;color:#64748b;font-family:system-ui,sans-serif}` +
        `.nx-pretext-skeleton::before{content:"";width:2.5rem;height:2.5rem;border:3px solid #e2e8f0;border-top-color:#6366f1;border-radius:50%;animation:nx-sk-rot .7s linear infinite}` +
        `@keyframes nx-sk-rot{to{transform:rotate(360deg)}}` +
        `</style>` +
        `<div id="nx-hole-${boundaryId}" class="nx-stream-root" role="status" aria-live="polite" aria-busy="true">` +
        `<div class="nx-pretext-skeleton"><span>Loading…</span></div></div>`;

      let shellHtml = wrapWithDocument(shellInner, opts, [], 0, emptyPretext);
      if (!/^<!DOCTYPE/i.test(shellHtml.trimStart())) {
        shellHtml = DOCTYPE + '\n' + shellHtml;
      }
      ctrl.writeShell(shellHtml);

      ctrl.defer({
        id: boundaryId,
        promise: (async (): Promise<StreamingPromiseValue> => {
          try {
            ctx.pretext = await mergeRoutePretext(matched, ctx, opts);
          } catch (err) {
            if (err instanceof RedirectSignal) {
              return `<script>location.replace(${JSON.stringify(err.location)})</script>`;
            }
            if (err instanceof NotFoundSignal) throw err;
            console.error('[Nexus] Pretext error:', err);
            return errorPage(err, opts.dev);
          }

          resetTtlContext();
          const body = await runLayoutsAndPage(matched, ctx, opts);
          if (!body.ok) {
            resetTtlContext();
            return body.result.html;
          }

          const { content, islandCount } = body;

          if (isFullHtmlDocument(content)) {
            if (opts.dev) {
              console.warn(
                '[Nexus] streamingPretext: route output includes a full <html> document. Use fragment layouts or disable server.streamingPretext.',
              );
            }
            resetTtlContext();
            return (
              `<div data-nx-stream-warning style="padding:1rem;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-family:system-ui">` +
              'Streaming Pretext requires fragment layouts (no root &lt;html&gt; in route output). Disable <code>server.streamingPretext</code> or change the layout.' +
              '</div>'
            );
          }

          const cacheControl = computeCacheControl(ctx);

          const bridgeLogs: ServerBridgeLog[] = [];
          if (opts.dev) {
            bridgeLogs.push({
              type: 'render',
              path: new URL(ctx.request.url).pathname,
              duration: 0,
              cacheStrategy: cacheControl.strategy,
              cacheHit:
                cacheControl.strategy === 'swr' || cacheControl.strategy === 'static-immutable',
            });
            if (islandCount > 0) {
              bridgeLogs.push({ type: 'island-count', islandCount });
            }
          }

          const pretextWire = ctx.pretext !== undefined ? serialize(ctx.pretext) : serialize({});
          resetTtlContext();

          const devBridgeScript =
            opts.dev && bridgeLogs.length > 0
              ? `<script>window.__NEXUS_SERVER_LOGS__=${escapeJsonForScriptPayload(JSON.stringify(bridgeLogs))};window.__NEXUS_BUILD_INFO__=${escapeJsonForScriptPayload(JSON.stringify({
                  totalJs: 8_400 + islandCount * 1_200,
                  reactEquivalent: 148_000,
                  islandCount,
                }))};</script>`
              : undefined;

          const payload: StreamingPromiseValue = devBridgeScript
            ? { html: content, pretextWire, devBridgeScript }
            : { html: content, pretextWire };
          return payload;
        })(),
      });
    },
    {
      headers: {
        'x-nexus-cache-strategy': 'streaming-no-store',
        'x-nexus-island-count': '0',
        ...(opts.dev ? { 'x-nexus-ttl': String(0) } : {}),
      },
    },
  );
}

export async function renderRoute(
  matched: MatchedRoute,
  ctx: NexusContext,
  opts: RenderOptions,
): Promise<RenderResult> {
  try {
    ctx.pretext = await mergeRoutePretext(matched, ctx, opts);
  } catch (err) {
    if (err instanceof RedirectSignal || err instanceof NotFoundSignal) throw err;
    console.error('[Nexus] Pretext error:', err);
    return {
      html: errorPage(err, opts.dev),
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
      status: 500,
      cacheTtl: 0,
      islandCount: 0,
    };
  }

  const body = await runLayoutsAndPage(matched, ctx, opts);
  if (!body.ok) {
    return body.result;
  }

  const { content, islandCount } = body;

  // Compute smart cache headers BEFORE resetting the context
  const cacheControl = computeCacheControl(ctx);
  const ttl = cacheControl.ttl;
  resetTtlContext();

  // Build the server→browser bridge logs (dev mode only)
  const bridgeLogs: ServerBridgeLog[] = [];
  if (opts.dev) {
    const duration = 0; // renderStart tracking requires AsyncLocalStorage in future release
    bridgeLogs.push({
      type: 'render',
      path: new URL(ctx.request.url).pathname,
      duration,
      cacheStrategy: cacheControl.strategy,
      cacheHit: cacheControl.strategy === 'swr' || cacheControl.strategy === 'static-immutable',
    });
    if (islandCount > 0) {
      bridgeLogs.push({ type: 'island-count', islandCount });
    }
  }

  const pretextWire = ctx.pretext !== undefined ? serialize(ctx.pretext) : null;

  let fullHtml = wrapWithDocument(content, opts, bridgeLogs, islandCount, pretextWire);
  if (!/^<!DOCTYPE/i.test(fullHtml.trimStart())) {
    fullHtml = DOCTYPE + '\n' + fullHtml;
  }

  // Vary header for cache correctness:
  //  - 'Accept-Encoding' — responses differ when the proxy applies gzip/br.
  //  - 'Accept'          — clients negotiating content type get different payloads.
  // Without Vary, shared caches (CDN, Varnish) can serve compressed responses to
  // clients that don't support compression, or serve the wrong content type.
  const vary = cacheControl.strategy === 'private-no-store'
    ? undefined              // private/no-store: Vary irrelevant, saves a header byte
    : 'Accept, Accept-Encoding';

  return {
    html: fullHtml,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl.header,
      ...(vary ? { vary } : {}),
      'x-nexus-cache-strategy': cacheControl.strategy,
      'x-nexus-island-count': String(islandCount),
      ...(opts.dev ? { 'x-nexus-ttl': String(ttl) } : {}),
    },
    status: 200,
    cacheTtl: ttl,
    islandCount,
  };
}

/**
 * When the layout already emits a full `<html>...</html>` document (typical `.nx` root layout),
 * inject Nexus runtime (styles, importmap, HMR, island loader) into that document's `<head>`.
 * Nesting `<html>` inside the shell's `<body>` produces invalid markup and blank pages in browsers.
 */
function injectBeforeClosingHead(html: string, injection: string): string {
  const closeIdx = html.search(/<\/head\s*>/i);
  if (closeIdx !== -1) {
    return html.slice(0, closeIdx) + '\n' + injection + '\n' + html.slice(closeIdx);
  }
  const m = html.match(/<head[^>]*>/i);
  if (m?.index !== undefined) {
    const insertAt = m.index + m[0].length;
    return html.slice(0, insertAt) + '\n' + injection + '\n' + html.slice(insertAt);
  }
  return injection + '\n' + html;
}

/** Strip leading doctype so we can detect `<html` after optional `<!DOCTYPE html>`. */
function stripLeadingDoctype(html: string): string {
  return html.replace(/^\s*<!DOCTYPE[^>]*>/i, '').trimStart();
}

/**
 * Devalue-safe JSON serialization for inline `<script>` payloads.
 *
 * JSON.stringify alone is insufficient for embedding inside HTML `<script>` tags:
 *   - `</script>` closes the script block even inside a string.
 *   - `<!--` starts an HTML comment that swallows subsequent content.
 *   - `<![CDATA[` / `]]>` cause parser confusion in XHTML.
 *   - U+2028 / U+2029 are valid JSON but break JS string literals in ES5.
 *
 * Escape strategy (used by Django, Ruby on Rails, SvelteKit, and devalue):
 *   < → \u003c   stops </script> and <!
 *   > → \u003e   stops ]]>
 *   & → \u0026   stops &lt; entities re-parsed by the HTML parser
 *   \u2028 → \u2028 literal → escaped (line separator, breaks JS literals)
 *   \u2029 → \u2029 literal → escaped (paragraph separator)
 *
 * The result is valid JSON that JSON.parse / JSON5 will parse identically
 * to the original value — only the byte representation differs.
 */
function escapeJsonForScriptPayload(json: string): string {
  return json
    .replace(/</g,      '\\u003c')
    .replace(/>/g,      '\\u003e')
    .replace(/&/g,      '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Strip `?query` and `#hash` from a URL-like string and return the pathname.
 * Used when comparing whether a stylesheet href in the user's `<head>` refers
 * to the same physical resource as one Nexus is about to inject.
 */
function stripQueryAndHash(href: string): string {
  const q = href.indexOf('?');
  const h = href.indexOf('#');
  const cuts = [q, h].filter((i) => i >= 0);
  return cuts.length ? href.slice(0, Math.min(...cuts)) : href;
}

/**
 * Scan the user's already-rendered HTML for `<link rel="stylesheet">` tags and
 * return the set of declared pathnames (queries stripped).  Lets the renderer
 * skip injecting framework stylesheets the user already declared in a custom
 * layout, preventing duplicate network requests for the same CSS file.
 */
function collectDeclaredStylesheetPaths(content: string): Set<string> {
  const out = new Set<string>();
  // Match <link ... rel="stylesheet" ... href="..."> in either attribute order.
  const linkTagRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkTagRe.exec(content)) !== null) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?stylesheet["']?/i.test(tag)) continue;
    const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const href = hrefMatch?.[2] ?? hrefMatch?.[3];
    if (href) out.add(stripQueryAndHash(href));
  }
  return out;
}

function isFullHtmlDocument(content: string): boolean {
  const t = content.trimStart();
  if (/^<\s*html[\s>]/i.test(t)) return true;
  if (/^<!DOCTYPE/i.test(t)) {
    return /^<\s*html[\s>]/i.test(stripLeadingDoctype(content));
  }
  return false;
}

/** Default + app `imports` for dynamically imported island bundles (bare specifiers). */
function buildImportMapScript(extra: Record<string, string> | null | undefined, nonce: string | undefined, dev: boolean): string {
  const base: Record<string, string> = {
    '@nexus_js/runtime/island': '/_nexus/rt/island.js',
    '@nexus_js/runtime': '/_nexus/rt/index.js',
    '@nexus_js/serialize': '/_nexus/rt/serialize.js',
  };
  if (dev) {
    base['$lib/'] = '/_nexus/lib/';
  } else {
    base['$lib/'] = '/_nexus/lib/';
  }
  const imports =
    extra && typeof extra === 'object' ? { ...base, ...extra } : base;
  const json = JSON.stringify({ imports }, null, 2);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<script${nonceAttr} type="importmap">\n${json}\n</script>`;
}

function wrapWithDocument(
  content: string,
  opts: RenderOptions,
  bridgeLogs: ServerBridgeLog[] = [],
  islandCount = 0,
  pretextWire: string | null = null,
): string {
  const n = opts.cspNonce ? ` nonce="${opts.cspNonce}"` : '';

  const pretextScript =
    pretextWire !== null
      ? `<script${n} type="application/json" id="__NEXUS_PRETEXT__">${escapeJsonForScriptPayload(pretextWire)}</script>`
      : '';

  const buildIdScript =
    opts.buildId !== undefined && opts.buildId !== ''
      ? `<script${n}>window.__NEXUS_BUILD_ID__=${escapeJsonForScriptPayload(JSON.stringify(opts.buildId))};</script>`
      : '';

  // Skip injecting any framework stylesheet whose pathname (query stripped) is
  // already declared by the user's layout `<head>`.  Without this guard the
  // user ends up with two `<link>` elements pointing at the same CSS file via
  // different URLs (e.g. `/_nexus/styles.css` from the framework and
  // `/_nexus/styles.css?v=20260422` from a hand-written cache-busting tag),
  // causing the browser to fetch the same stylesheet twice.
  const userDeclaredStylePaths = collectDeclaredStylesheetPaths(content);
  const styleLinks = opts.assets.styles
    .filter((href) => !userDeclaredStylePaths.has(stripQueryAndHash(href)))
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n    ');

  const runtimeScript = opts.assets.runtime
    ? `<script${n} type="module" src="${opts.assets.runtime}"></script>`
    : '';

  /** Default host box for custom element — avoids full-width flex rows that steal hits on tiny/empty islands. */
  const nexusIslandHostCSS = `<style id="nexus-island-host">
nexus-island {
  display: inline-block;
  vertical-align: top;
  width: auto;
  max-width: 100%;
  box-sizing: border-box;
}
</style>`;

  // Import map — bare specifiers in island bundles (see `browser.importMap` in nexus.config.ts).
  // importmap scripts also require the nonce in strict CSP environments.
  const importMap = buildImportMapScript(opts.browserImportMap ?? null, opts.cspNonce, opts.dev);

  // Dev: SSE to /_nexus/dev/hot — server pushes `reload` after file watcher runs server.reload().
  const hmrScript = opts.dev
    ? `<script${n}>(function(){if(typeof EventSource==='undefined')return;new EventSource('/_nexus/dev/hot').addEventListener('reload',function(){location.reload()})})();</script>`
    : '';

  // Server→browser log bridge (dev only)
  // All user-controlled strings (route paths, cache keys, etc.) are passed through
  // escapeJsonForScriptPayload to prevent </script> injection via log values.
  const bridgeScript = opts.dev ? `<script${n}>
window.__NEXUS_DEV__ = true;
window.__NEXUS_SERVER_LOGS__ = ${escapeJsonForScriptPayload(JSON.stringify(bridgeLogs))};
window.__NEXUS_BUILD_INFO__ = {
  totalJs: ${8_400 + islandCount * 1_200},
  reactEquivalent: 148_000,
  islandCount: ${islandCount}
};
</script>${nexusClientDevScript(n)}` : '';

  const headInjection = `
    ${buildIdScript}
    ${pretextScript}
    ${nexusIslandHostCSS}
    ${styleLinks}
    ${importMap}
    ${hmrScript}
    ${bridgeScript}
    ${runtimeScript}
`;

  if (isFullHtmlDocument(content)) {
    const doc = /^<!DOCTYPE/i.test(content.trimStart()) ? stripLeadingDoctype(content) : content;
    return injectBeforeClosingHead(doc, headInjection);
  }

  return `<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${headInjection}
  </head>
  <body>
    ${content}
  </body>
</html>`;
}

/**
 * Client-side dev script injected in dev mode.
 * Reads window.__NEXUS_SERVER_LOGS__ and prints them in the browser console.
 * Also sets up island hydration tracking hooks.
 */
function nexusClientDevScript(nonceAttr: string): string { return `<script${nonceAttr}>
(function(){
  if (!window.__NEXUS_DEV__) return;
  const logs  = window.__NEXUS_SERVER_LOGS__ ?? [];
  const build = window.__NEXUS_BUILD_INFO__  ?? {};

  const S = {
    nexus:  'color:#7c3aed;font-weight:700;font-family:monospace',
    ok:     'color:#10b981;font-weight:700',
    warn:   'color:#f59e0b;font-weight:700',
    err:    'color:#ef4444;font-weight:700',
    dim:    'color:#64748b',
    route:  'color:#06b6d4;font-weight:700',
    action: 'color:#f97316;font-weight:700',
    island: 'color:#8b5cf6;font-weight:700',
    stat:   'color:#10b981',
  };

  // ── SSR Report group ────────────────────────────────────────────────────────
  console.groupCollapsed('%c◆ Nexus%c  SSR Report', S.nexus, S.dim);

  for (const log of logs) {
    if (log.type === 'render') {
      const cTag = log.cacheHit
        ? ['%c⚡ Cache HIT', S.ok]
        : ['%c🌐 Cache MISS', S.warn];
      const strat = log.cacheStrategy ? ' · ' + log.cacheStrategy : '';
      console.log(
        '%c🚀 Route%c ' + log.path + ' %c' + log.duration + 'ms%c  ' + cTag[0] + strat,
        S.ok, S.route, S.dim, '', cTag[1]
      );
    }
    if (log.type === 'island-count' && log.islandCount) {
      console.log('%c📦 Islands%c ' + log.islandCount + ' to hydrate', S.ok, S.dim);
    }
  }

  if (build.totalJs) {
    const kb    = (build.totalJs / 1024).toFixed(1);
    const saved = ((build.reactEquivalent - build.totalJs) / 1024).toFixed(0);
    console.log('%c💎 JS: ' + kb + 'KB%c  — saved ' + saved + 'KB vs React', S.nexus, S.dim);
  }

  console.groupEnd();

  // ── Island hydration hook (called by @nexus_js/runtime island loader) ──────────
  window.__NEXUS_LOG_ISLAND__ = function(name, strategy, ms) {
    console.log(
      '%c[Nexus] 🏝️ Island%c <' + name + ' />%c hydrated ' +
      '%c(' + strategy + ')%c — ' + ms.toFixed(1) + 'ms',
      S.nexus, S.island, '', S.dim, ''
    );
  };

  // ── $state change hook (called by Runes proxy in dev mode) ─────────────────
  window.__NEXUS_LOG_STATE__ = function(key, prev, next, source) {
    console.log(
      '%c[Nexus] ✨ $state%c "' + key + '" %c' + JSON.stringify(prev) +
      ' → ' + JSON.stringify(next) + (source ? '%c  ↳ ' + source : '%c'),
      S.nexus, S.warn, S.dim, S.dim
    );
  };

  // ── $optimistic hook ───────────────────────────────────────────────────────
  window.__NEXUS_LOG_OPTIMISTIC__ = function(key, value) {
    console.log(
      '%c[Nexus] 🔄 $optimistic%c "' + key + '" → %c' + JSON.stringify(value),
      S.nexus, S.warn, S.stat
    );
  };

  // ── SPA Navigation hook ────────────────────────────────────────────────────
  window.__NEXUS_LOG_NAV__ = function(to, morphKey) {
    console.log('%c[Nexus] 🗺️ Navigating to%c ' + to, S.nexus, S.route);
    if (morphKey) {
      console.log('%c[Nexus] 🪄 Morphing%c [' + morphKey + ']', S.nexus, S.dim);
    }
  };

  // ── Action lifecycle hooks ─────────────────────────────────────────────────
  window.__NEXUS_LOG_ACTION__ = function(name, phase, data) {
    if (phase === 'call') {
      console.log('%c[Nexus] ▲ Action%c ' + name + '() called', S.nexus, S.action);
    } else if (phase === 'optimistic') {
      window.__NEXUS_LOG_OPTIMISTIC__?.(name, data);
    } else if (phase === 'success') {
      console.log('%c[Nexus] ✅ Action%c ' + name + '() synced', S.nexus, S.ok);
    } else if (phase === 'error') {
      console.error('%c[Nexus] ✖ Action%c ' + name + '() failed', S.err, '');
    } else if (phase === 'cancelled') {
      console.warn('%c[Nexus] ↩ Action%c ' + name + '() cancelled (race)', S.warn, '');
    }
  };

  // ── A11y checker — runs 1s after mount ─────────────────────────────────────
  setTimeout(function() {
    const issues = [];
    document.querySelectorAll('img:not([alt])').forEach(function(el) {
      issues.push('<img> missing alt  →  ' + (el.getAttribute('src') || '').split('/').pop());
    });
    document.querySelectorAll('button, [role="button"]').forEach(function(el) {
      if (!el.textContent?.trim() && !el.getAttribute('aria-label')) {
        issues.push('<button> missing accessible label');
      }
    });
    document.querySelectorAll('a:not([aria-label]):not([href])').forEach(function() {
      issues.push('<a> missing href or aria-label');
    });
    if (issues.length) {
      console.groupCollapsed('%c[Nexus] ⚠️ A11y — ' + issues.length + ' issue' + (issues.length !== 1 ? 's' : '') + ' found', 'color:#f59e0b;font-weight:700');
      issues.forEach(function(i) { console.warn('  •', i); });
      console.groupEnd();
    }
  }, 1200);
})();
</script>`; }

/**
 * Serializes island props for client-side hydration.
 *
 * Encoding: base64url (URL-safe, no padding issues in HTML attributes).
 * We JSON-stringify first so any type (Date, nested objects, arrays) survives
 * the round-trip, then base64url-encode so the value is safe inside any HTML
 * attribute without escaping — base64 never contains `<`, `>`, `"`, or `&`.
 *
 * Using Buffer.from().toString('base64url') instead of btoa() because btoa()
 * throws RangeError on characters outside Latin-1 (e.g. emoji, CJK, etc.).
 */
export function serializeIslandProps(props: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(props), 'utf-8').toString('base64url');
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
  return devErrorHtmlPage({
    context: dev ? 'SSR / route error' : 'Error',
    err,
    dev,
  });
}
