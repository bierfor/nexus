/**
 * Nexus Server — Node.js HTTP server adapter.
 * Handles SSR, static assets, Server Actions and dev HMR.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buildRouteManifest, matchRoute } from '@nexus_js/router';
import type { RouteManifest } from '@nexus_js/router';
import { handleActionRequest } from './actions.js';
import { handleSSERequestNode, isConnectRequest, topicFromUrl } from '@nexus_js/connect';
import {
  buildAggregatedNxStylesheet,
  bustAggregatedStylesCache,
  compileIslandClientBundle,
  getAggregatedCssETag,
  isIslandClientRequest,
  tryServeRuntimeAsset,
} from './dev-assets.js';
import { tryServeLibAsset } from './lib-assets.js';
import { devErrorHtmlPage } from './dev-error-html.js';
import { broadcastDevHotReload, subscribeDevHotClient } from './dev-hot.js';
import { renderRoute, renderRouteStreaming } from './renderer.js';
import { pipeToNodeResponse } from './streaming.js';
import { handleNavigationRequest } from './navigate.js';
import { bumpDevReloadGeneration, preloadRegisteredServerActions } from './load-module.js';
import { createContext, RedirectSignal, NotFoundSignal } from './context.js';
import type { RenderOptions } from './renderer.js';
import { nexusVault, getTenantVaultSecretsMap, getVaultSecretsMap } from '@nexus_js/security';
import { handleDevVaultPost } from './dev-vault.js';
import { resolveTenant, type TenancyConfig, type TenantResolution } from './tenancy.js';
import {
  refreshShieldAllowlist,
  isActionBlockedByShield,
  setShieldLite,
} from './shield-runtime.js';
import { loadAndCacheNexusBuildId } from './build-id.js';
import { emitDevRadar } from './devradar.js';

export { STUDIO_DEFAULT_PORT } from './constants.js';
export {
  createAction,
  registerAction,
  ActionError,
  getRegisteredActionNames,
  isInternalUrl,
  isSafeUrl,
} from './actions.js';
export { loadAndCacheNexusBuildId, getExpectedNexusBuildId } from './build-id.js';
export { createContext } from './context.js';
export { nexusVault } from '@nexus_js/security';
export { resolveTenant } from './tenancy.js';
export type { NexusContext, NexusLocals, CookieOptions } from './context.js';
export type { TenancyConfig, TenantResolution } from './tenancy.js';
export type { RenderResult, RenderOptions } from './renderer.js';
export { mergeRoutePretext } from './renderer.js';
export { defineMetadata, escapeHtml } from './metadata.js';
export type { MetadataInput, MetadataResult } from './metadata.js';
export { registerDevRadarSink, emitDevRadar, sanitizeTelemetryValue, newTraceId } from './devradar.js';
export type {
  DevRadarEvent,
  ActionCallPayload,
  ActionResultPayload,
  ActionErrorPayload,
  PretextProfilePayload,
  SecurityAuditPayload,
  SecurityReportPayload,
  SecurityReportCheck,
  RuneTelemetryPayload,
} from './devradar.js';
export { wrapExpressMiddleware, wrapExpressHandler } from './legacy-wrapper.js';
export type { ExpressMiddleware } from './legacy-wrapper.js';

/**
 * Returns true when an Origin header value is a loopback address (localhost,
 * 127.x.x.x, ::1, 0.0.0.0) or the opaque "null" value.
 * Used to protect dev-only endpoints from external network access.
 * "null" is explicitly rejected here (unlike the action handler) because dev
 * endpoints must never be reachable from sandboxed or opaque contexts.
 */
function isLoopbackOrigin(origin: string): boolean {
  if (origin === 'null') return false; // opaque origin — never trusted
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      /^127\.\d+\.\d+\.\d+$/.test(hostname)
    );
  } catch {
    return false;
  }
}

/** Merge ctx response headers (Set-Cookie, etc.) with redirect Location. */
function redirectHeadersForWriteHead(err: RedirectSignal): Record<string, string | string[]> {
  const setCookies: string[] = [];
  const out: Record<string, string | string[]> = { location: err.location };
  err.responseHeaders.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      setCookies.push(value);
    } else {
      out[key] = value;
    }
  });
  if (setCookies.length === 1) {
    out['set-cookie'] = setCookies[0]!;
  } else if (setCookies.length > 1) {
    out['set-cookie'] = setCookies;
  }
  return out;
}

export interface RequestLogInfo {
  method: string;
  path: string;
  status: number;
  /** Request duration in milliseconds */
  duration: number;
  /** Cache strategy used by the renderer (e.g. 'swr', 'static-immutable', 'no-store') */
  cacheStrategy?: string;
  /** True when the route was served from a Server Action */
  isAction?: boolean;
}

/**
 * Custom route mount — handler is called before static files and SSR.
 * Compatible with `@nexus_js/graphql` createGraphQLHandler() and any other
 * Web-standard (Request → Response) handler.
 *
 * @example
 *   import { createGraphQLHandler } from '@nexus_js/graphql';
 *   mounts: [{ path: '/graphql', handler: createGraphQLHandler({ schema }) }]
 */
export interface NexusMountDef {
  /**
   * URL path prefix to match. The handler is invoked when
   * `request.url.pathname === path` or starts with `path + '/'`.
   */
  path: string;
  /**
   * HTTP methods to handle. Default: all methods including OPTIONS
   * (needed for GraphQL CORS preflight).
   */
  methods?: string[];
  /**
   * Web-standard handler.
   * `nexusCtx` gives access to `secrets`, `locals`, `getCookie`, etc.
   */
  handler: (request: Request, nexusCtx: import('./context.js').NexusContext) => Promise<Response>;
}

export interface NexusServerOptions {
  /** Root directory of the Nexus app */
  root: string;
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Enable dev mode (HMR, verbose errors, detailed logs) */
  dev?: boolean;
  /** Static assets directory */
  publicDir?: string;
  /**
   * Called after each HTTP request completes.
   * Use this to implement a custom request logger in the CLI or integrations.
   * The server itself does NOT print request logs — the host controls formatting.
   */
  onRequest?: (info: RequestLogInfo) => void;
  /**
   * Custom route handlers mounted before static files and SSR.
   * Evaluated in order; the first matching mount wins.
   * Use for GraphQL endpoints, webhooks, or any non-Nexus HTTP handler.
   */
  mounts?: NexusMountDef[];
  /**
   * HTTP proxy fallback for legacy backend integration.
   * If a request doesn't match any Nexus route, mount, or static file,
   * forward it to this URL instead of returning 404.
   * 
   * Use this for gradual migration: Nexus sits in front of your old backend,
   * handling new routes while forwarding unknown paths to the legacy system.
   * 
   * @example { fallbackProxy: 'http://localhost:8080' }
   */
  fallbackProxy?: string;
  /**
   * From `nexus.config.ts` `security` — when `hardened: true`, HTML and API responses get baseline security headers.
   * `shieldLite`: unknown server action names return 403 (manifest + registry allowlist) instead of 404.
   * `csp`: extend the generated Content-Security-Policy with additional allowed sources per directive.
   */
  security?: {
    hardened?: boolean;
    shieldLite?: boolean;
    csp?: {
      /**
       * Extra origins for `style-src` — e.g. `['https://fonts.googleapis.com']` for Google Fonts.
       * Nexus always includes `'self' 'unsafe-inline'`; these are appended after.
       */
      additionalStyleSrc?: string[];
      /**
       * Extra origins for `font-src` — e.g. `['https://fonts.gstatic.com']` for Google Fonts files.
       * Nexus always includes `'self'`; these are appended after.
       */
      additionalFontSrc?: string[];
      /**
       * Extra origins for `script-src` — e.g. `['https://cdn.example.com']` for external scripts.
       */
      additionalScriptSrc?: string[];
      /**
       * Extra origins for `connect-src` — e.g. `['https://api.example.com']` for fetch/XHR/WS.
       * Nexus always includes `'self'`; these are appended after.
       */
      additionalConnectSrc?: string[];
      /**
       * Extra origins for `img-src` — e.g. `['https://cdn.example.com']` for external images.
       * Nexus always includes `'self' data: blob:`; these are appended after.
       */
      additionalImgSrc?: string[];
      /**
       * Extra sources for `frame-src` (after baseline `'self' blob:`).
       * Use for embeds, e.g. `['https://www.youtube-nocookie.com']`.
       */
      additionalFrameSrc?: string[];
    };
  };
  /**
   * Flush the HTML shell (head + skeleton) before `nxPretext` resolves — improves TTFB when Pretext is slow.
   * Fragment layouts only (route output must not be a full `&lt;html&gt;` document).
   */
  streamingPretext?: boolean;
  /** Merged into document import map for island `import()` resolution (from `nexus.config` `browser.importMap`). */
  browserImportMap?: Record<string, string>;

  /** Nexus Connect (SSE) endpoint configuration. */
  connect?: {
    /** Which browser origins may subscribe to `/_nexus/connect/*`. Default: `'self'` in production, `'*'` in dev. */
    corsOrigins?: 'self' | '*' | string[];
  };

  tenancy?: TenancyConfig & {
    vaultIsolation?: 'strict' | 'fallback';
  };
}

type CspOptions = NonNullable<NexusServerOptions['security']>['csp'];

/** Merge Hardened Mode headers — includes per-request CSP nonce when hardened. */
function mergeHardenedHeaders(
  headers: Record<string, string | string[] | number | undefined>,
  hardened: boolean | undefined,
  dev: boolean,
  cspNonce?: string,
  cspOptions?: CspOptions,
): Record<string, string | string[] | number> {
  const h: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) h[k] = v;
  }
  if (!hardened) return h;

  h['x-frame-options'] = 'DENY';
  h['x-content-type-options'] = 'nosniff';
  h['referrer-policy'] = 'strict-origin-when-cross-origin';
  h['permissions-policy'] = 'camera=(), microphone=(), geolocation=()';
  h['x-nexus-security'] = 'hardened';

  if (!dev) {
    h['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }

  // Content-Security-Policy with per-request nonce for inline scripts.
  // script-src: 'self' for external scripts, nonce for inline scripts (Nexus-generated).
  //             Custom inline scripts in templates get the nonce via ctx.cspNonce.
  // object-src: 'none' blocks Flash / legacy plugin execution.
  // base-uri: 'self' prevents base tag injection (open redirect via <base href>).
  if (cspNonce) {
    const extraStyle = cspOptions?.additionalStyleSrc?.join(' ') ?? '';
    const extraFont = cspOptions?.additionalFontSrc?.join(' ') ?? '';
    const extraScript = cspOptions?.additionalScriptSrc?.join(' ') ?? '';
    const extraConnect = cspOptions?.additionalConnectSrc?.join(' ') ?? '';
    const extraImg = cspOptions?.additionalImgSrc?.join(' ') ?? '';
    const extraFrame = cspOptions?.additionalFrameSrc?.join(' ') ?? '';

    const scriptSrc = dev
      ? `'self' 'nonce-${cspNonce}' 'unsafe-eval'${extraScript ? ` ${extraScript}` : ''}`
      : `'self' 'nonce-${cspNonce}'${extraScript ? ` ${extraScript}` : ''}`;

    h['content-security-policy'] =
      `default-src 'self'; ` +
      // default-src does not allow blob: for iframes; leave worker-src unset so it falls back to script-src (CDN workers).
      `frame-src 'self' blob:${extraFrame ? ` ${extraFrame}` : ''}; ` +
      `script-src ${scriptSrc}; ` +
      `style-src 'self' 'unsafe-inline'${extraStyle ? ` ${extraStyle}` : ''}; ` +
      `img-src 'self' data: blob:${extraImg ? ` ${extraImg}` : ''}; ` +
      `font-src 'self'${extraFont ? ` ${extraFont}` : ''}; ` +
      `connect-src 'self'${extraConnect ? ` ${extraConnect}` : ''}; ` +
      `object-src 'none'; ` +
      `base-uri 'self'; ` +
      `form-action 'self'`;
  }

  return h;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
};

export async function createNexusServer(opts: NexusServerOptions) {
  const port = opts.port ?? 3000;
  const dev = opts.dev ?? false;
  const routesDir = join(opts.root, 'src', 'routes');
  const publicDir = join(opts.root, opts.publicDir ?? 'public');

  setShieldLite(opts.security?.shieldLite === true);

  let manifest: RouteManifest = await buildRouteManifest(routesDir);

  const nexusBuildId = loadAndCacheNexusBuildId(opts.root);

  const renderOpts: RenderOptions = {
    dev,
    appRoot: opts.root,
    ...(nexusBuildId ? { buildId: nexusBuildId } : {}),
    ...(opts.browserImportMap ? { browserImportMap: opts.browserImportMap } : {}),
    assets: {
      /** ESM entry + chunks served from @nexus_js/runtime/dist via /_nexus/rt/* */
      runtime: '/_nexus/rt/index.js',
      styles: ['/_nexus/styles.css'],
      islands: new Map(),
    },
  };

  const hardened = opts.security?.hardened === true;
  const cspConfig = opts.security?.csp;

  // `sec` without a nonce — used for non-HTML responses (JSON, static files, actions).
  const sec = (h: Record<string, string | string[] | number | undefined>) =>
    mergeHardenedHeaders(h, hardened, dev, undefined, cspConfig);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const t0  = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if ((method === 'GET' || method === 'HEAD') && url.pathname === '/_nexus/health') {
      const payload = {
        ok: true,
        ts: Date.now(),
        buildId: nexusBuildId ?? null,
      };
      res.writeHead(200, sec({ 'content-type': 'application/json; charset=utf-8' }));
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(JSON.stringify(payload));
      }
      return;
    }

    // Generate a per-request CSP nonce for HTML responses (hardened mode only).
    // Same nonce is injected into inline <script> tags and the CSP header.
    const cspNonce = hardened ? randomBytes(16).toString('base64url') : undefined;

    // Capture cache strategy before headers are flushed, then call onRequest hook
    let _cacheStrategy: string | undefined;
    let _isAction = false;
    if (opts.onRequest) {
      res.on('finish', () => {
        const info: RequestLogInfo = {
          method,
          path: url.pathname,
          status: res.statusCode,
          duration: Date.now() - t0,
          isAction: _isAction,
        };
        if (_cacheStrategy !== undefined) info.cacheStrategy = _cacheStrategy;
        opts.onRequest!(info);
      });
    }

    // ── Dev hot-reload (SSE) — browser listens and calls location.reload() ──
    // Guard dev-only endpoints against external origin access. Browsers on the
    // same machine will send no Origin (direct navigation) or a loopback Origin.
    // An attacker on the network sending a cross-origin request is rejected.
    if (dev && method === 'GET' && url.pathname === '/_nexus/dev/hot') {
      const devOrigin = req.headers['origin'];
      if (devOrigin && !isLoopbackOrigin(devOrigin)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Forbidden: dev endpoint requires loopback origin');
        return;
      }
      subscribeDevHotClient(req, res);
      return;
    }

    // ── Vault-lite (dev) — hot-reload secrets without restart ───────────────
    if (dev && method === 'POST' && url.pathname === '/_nexus/dev/vault') {
      const devOrigin = req.headers['origin'];
      if (devOrigin && !isLoopbackOrigin(devOrigin)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Forbidden: dev endpoint requires loopback origin');
        return;
      }
      const request = await incomingMessageToWebRequest(req);
      const response = await handleDevVaultPost(request);
      await webToNodeResponse(response, res, sec);
      return;
    }

    // ── Server Actions ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/_nexus/action/')) {
      _isAction = true;
      const actionName = url.pathname.slice('/_nexus/action/'.length).replace(/\/.*$/, '');
      if (actionName !== '' && isActionBlockedByShield(actionName)) {
        emitDevRadar({
          type: 'security:audit',
          payload: {
            kind: 'shield_action',
            message: 'Blocked: action not in Shield-lite allowlist',
            action: actionName,
          },
        });
        res.writeHead(
          403,
          sec({
            'content-type': 'application/json',
            'x-nexus-shield': 'block',
          }) as Record<string, string | string[] | number>,
        );
        res.end(
          JSON.stringify({
            error: 'Forbidden',
            status: 403,
            code: 'SHIELD_BLOCK',
          }),
        );
        return;
      }
      const request = await incomingMessageToWebRequest(req);
      const response = await handleActionRequest(request);
      await webToNodeResponse(response, res, sec);
      return;
    }

    // ── Nexus Connect — SSE (/_nexus/connect/:topic) ────────────────────────
    if (method === 'GET' && isConnectRequest(url)) {
      const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined;
      const host = typeof req.headers['host'] === 'string' ? req.headers['host'] : undefined;
      const corsMode = opts.connect?.corsOrigins ?? (dev ? '*' : 'self');

      let allowOrigin: string | undefined;

      if (corsMode === '*') {
        allowOrigin = '*';
      } else if (corsMode === 'self') {
        if (!origin) {
          allowOrigin = '*';
        } else {
          try {
            const o = new URL(origin);
            if (host && o.host === host) {
              allowOrigin = origin;
            }
          } catch {
            allowOrigin = undefined;
          }
        }
      } else if (Array.isArray(corsMode)) {
        if (origin && corsMode.includes(origin)) {
          allowOrigin = origin;
        }
      }

      if (origin && !allowOrigin) {
        res.writeHead(403, sec({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end('Forbidden');
        return;
      }

      handleSSERequestNode(req, res, topicFromUrl(url));
      return;
    }

    // ── @nexus_js/runtime ESM (browser import graph: /_nexus/rt/index.js → ./island.js …)
    const rt = await tryServeRuntimeAsset(url.pathname, opts.root);
    if (rt) {
      res.writeHead(200, { 'content-type': rt.contentType });
      res.end(rt.body);
      return;
    }

    const libAsset = await tryServeLibAsset(url.pathname, opts.root, dev);
    if (libAsset) {
      res.writeHead(200, {
        'content-type': libAsset.contentType,
        'cache-control': dev ? 'no-store' : 'public, max-age=0, must-revalidate',
      });
      res.end(libAsset.body);
      return;
    }

    // ── Client island ESM (dynamic import target for <nexus-island>) ───────
    if (isIslandClientRequest(url.pathname) && method === 'GET') {
      let out: { body: string; status: number };
      try {
        out = await compileIslandClientBundle(opts.root, url);
      } catch (err) {
        // Last-resort catch: compileIslandClientBundle should never throw (it
        // wraps its internals), but if it does we must still respond with valid
        // JavaScript so the browser gets a parseable error rather than HTML.
        const msg = err instanceof Error ? err.message : String(err);
        out = {
          body: `throw new Error(${JSON.stringify(`[Nexus] Unexpected island error: ${msg}`)});`,
          status: 500,
        };
      }
      res.writeHead(out.status, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(out.body);
      return;
    }

    // ── Image optimizer (AVIF/WebP/resize) — same contract as Vite dev middleware
    if (url.pathname === '/_nexus/image' && (method === 'GET' || method === 'HEAD')) {
      const request = nodeToWebRequest(req);
      const { handleImageRequest } = await import('@nexus_js/assets');
      const response = await handleImageRequest(request, { publicDir });
      if (method === 'HEAD') {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        res.writeHead(response.status, sec(headers));
        res.end();
        return;
      }
      await webToNodeResponse(response, res, sec);
      return;
    }

    // ── Aggregated scoped CSS from all .nx files under src/
    if (url.pathname === '/_nexus/styles.css' && method === 'GET') {
      try {
        const css  = await buildAggregatedNxStylesheet(opts.root);
        const etag = getAggregatedCssETag();

        // Conditional GET (If-None-Match) — eliminates FOUC on hard refresh
        // (Cmd+R / Ctrl+F5).  The browser caches the stylesheet and on each
        // reload sends If-None-Match with the stored ETag.  When the CSS has
        // not changed the server responds 304 instantly (no recompilation
        // needed) and the browser reuses its cached copy, applying styles
        // before the first paint rather than waiting for a full roundtrip.
        //
        // `cache-control: no-cache` (not `no-store`) lets the browser keep
        // the response in its local cache but forces it to revalidate before
        // use.  When a file changes, `bustAggregatedStylesCache()` resets the
        // ETag, so the next request returns 200 with the updated CSS.
        if (dev && etag && req.headers['if-none-match'] === etag) {
          res.writeHead(304, { 'cache-control': 'no-cache', etag });
          res.end();
          return;
        }

        const cacheControl = dev ? 'no-cache' : 'public, max-age=300';
        const headers: Record<string, string> = {
          'content-type':  'text/css; charset=utf-8',
          'cache-control': cacheControl,
        };
        if (etag) headers['etag'] = etag;

        res.writeHead(200, headers);
        res.end(css);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`[Nexus] Failed to build styles: ${msg}`);
      }
      return;
    }

    // ── SPA navigation JSON (/_nexus/navigate?path=…) — must run before SSR matchRoute
    if (url.pathname === '/_nexus/navigate' && method === 'GET') {
      const request = nodeToWebRequest(req);
      const response = await handleNavigationRequest(request, manifest, renderOpts);
      await webToNodeResponse(response, res, sec);
      return;
    }

    // ── Custom mounts (GraphQL, webhooks, etc.) ──────────────────────────────
    // Evaluated before static files so handlers can shadow public/ assets.
    for (const mount of opts.mounts ?? []) {
      const allowedMethods = mount.methods
        ? mount.methods.map(m => m.toUpperCase())
        : null; // null = allow all
      if (allowedMethods && !allowedMethods.includes(method)) continue;

      const pathname = url.pathname;
      const matches  = pathname === mount.path || pathname.startsWith(mount.path + '/');
      if (!matches) continue;

      const request = await incomingMessageToWebRequest(req);
      const ctx     = createContext(request, {}, cspNonce ?? '');
      try {
        const response = await mount.handler(request, ctx);
        await webToNodeResponse(response, res, sec);
      } catch (err) {
        if (dev) console.error(`[Nexus] Mount handler error (${mount.path}):`, err);
        res.writeHead(500, sec({ 'content-type': 'application/json' }) as Record<string, string | number>);
        res.end(JSON.stringify({ error: 'Internal Server Error', status: 500 }));
      }
      return;
    }

    // ── Static files ────────────────────────────────────────────────────────
    // Browsers still request /favicon.ico and /apple-touch-icon.png even when the
    // app only ships favicon.svg — avoid noisy 404s by falling back to SVG.
    if (
      method === 'GET' &&
      (url.pathname === '/favicon.ico' || url.pathname === '/apple-touch-icon.png')
    ) {
      const direct = await serveStatic(url.pathname, publicDir);
      if (direct) {
        res.writeHead(200, { 'content-type': direct.mime });
        res.end(direct.content);
        return;
      }
      const svgFallback = await serveStatic('/favicon.svg', publicDir);
      if (svgFallback) {
        res.writeHead(200, {
          'content-type': 'image/svg+xml',
          'cache-control': dev ? 'no-store' : 'public, max-age=86400',
        });
        res.end(svgFallback.content);
        return;
      }
    }

    const staticResult = await serveStatic(url.pathname, publicDir);
    if (staticResult) {
      res.writeHead(200, { 'content-type': staticResult.mime });
      res.end(staticResult.content);
      return;
    }

    // ── SSR routing ─────────────────────────────────────────────────────────
    const matched = matchRoute(url.pathname, manifest);
    if (!matched) {
      // ── Fallback proxy to legacy backend ──────────────────────────────────
      if (opts.fallbackProxy) {
        try {
          const targetUrl = new URL(url.pathname + url.search, opts.fallbackProxy);
          
          let body: Uint8Array | null = null;
          if (method !== 'GET' && method !== 'HEAD') {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              req.on('data', (chunk) => chunks.push(chunk));
              req.on('end', () => resolve());
              req.on('error', reject);
            });
            body = chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : null;
          }

          const proxyReq = await fetch(targetUrl.toString(), {
            method,
            headers: Object.fromEntries(
              Object.entries(req.headers)
                .filter(([k]) => {
                  const key = k.toLowerCase();
                  if (key === 'host') return false;
                  if (key === 'connection') return false;
                  if (key === 'keep-alive') return false;
                  if (key === 'proxy-authenticate') return false;
                  if (key === 'proxy-authorization') return false;
                  if (key === 'te') return false;
                  if (key === 'trailer') return false;
                  if (key === 'transfer-encoding') return false;
                  if (key === 'upgrade') return false;
                  if (key === 'content-length') return false;
                  return true;
                })
                .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])
            ),
            body: body as BodyInit | null,
          });

          const proxyHeaders: Record<string, string | string[]> = {};
          proxyReq.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'set-cookie') {
              const existing = proxyHeaders[key];
              if (Array.isArray(existing)) existing.push(value);
              else if (existing) proxyHeaders[key] = [existing, value];
              else proxyHeaders[key] = value;
            } else {
              proxyHeaders[key] = value;
            }
          });

          res.writeHead(proxyReq.status, proxyHeaders);
          if (proxyReq.body) {
            Readable.fromWeb(proxyReq.body as any).pipe(res);
          } else {
            res.end();
          }
          return;
        } catch (err) {
          if (dev) console.error('[Nexus] Fallback proxy error:', err);
          res.writeHead(502, sec({ 'content-type': 'text/html' }));
          res.end('<h1>502 Bad Gateway</h1><p>Legacy backend unavailable</p>');
          return;
        }
      }

      res.writeHead(404, sec({ 'content-type': 'text/html' }));
      res.end(notFoundPage(url.pathname, dev));
      return;
    }

    const request = nodeToWebRequest(req);
    const tenancyCfg = opts.tenancy;
    const tenant = tenancyCfg ? resolveTenant(request, tenancyCfg, getVaultSecretsMap()) : null;
    const ctx = createContext(request, matched.params, cspNonce ?? '');
    if (tenant) {
      ctx.locals['tenant'] = tenant;
      ctx.locals['tenantId'] = tenant.id;
      ctx.secrets = getTenantVaultSecretsMap(tenant.id, tenancyCfg?.vaultIsolation ?? 'strict');
    }

    try {
      if (opts.streamingPretext === true && method === 'GET') {
        _cacheStrategy = 'streaming-no-store';
        const streamRes = renderRouteStreaming(matched, ctx, renderOpts);
        await pipeToNodeResponse(streamRes, res, sec);
        return;
      }

      const requestRenderOpts = cspNonce ? { ...renderOpts, cspNonce } : renderOpts;
      const result = await renderRoute(matched, ctx, requestRenderOpts);
      _cacheStrategy = result.headers['x-nexus-cache-strategy'];
      const htmlHeaders = mergeHardenedHeaders(
        result.headers as Record<string, string | string[] | number | undefined>,
        hardened, dev, cspNonce, cspConfig,
      );
      res.writeHead(result.status, htmlHeaders);
      res.end(result.html);
    } catch (err) {
      if (err instanceof RedirectSignal) {
        res.writeHead(err.status, sec(redirectHeadersForWriteHead(err) as Record<string, string | string[] | number | undefined>));
        res.end();
        return;
      }
      if (err instanceof NotFoundSignal) {
        res.writeHead(404, sec({ 'content-type': 'text/html' }));
        res.end(notFoundPage(url.pathname, dev));
        return;
      }
      if (dev) {
        console.error(`\x1b[31m[Nexus Error]\x1b[0m ${method} ${url.pathname}`);
        console.error(err);
      } else {
        console.error('[Nexus] Unhandled error:', err);
      }
      res.writeHead(500, sec({ 'content-type': 'text/html' }));
      res.end(serverErrorPage(err, dev));
    }
  });

  return {
    /** Starts listening. Resolves when the server is bound to the port. */
    listen(): Promise<void> {
      return new Promise((resolve, reject) => {
        void (async () => {
          // Fail hard in production when NEXUS_SECRET is absent or is the
          // well-known dev placeholder. A predictable secret lets anyone forge
          // valid CSRF tokens, bypass replay protection, and hijack sessions.
          const envSecret = process.env['NEXUS_SECRET'];
          if (!dev) {
            if (!envSecret || envSecret === 'nexus-dev-secret-change-me') {
              throw new Error(
                '[Nexus Security] NEXUS_SECRET is not set (or is the insecure dev default). ' +
                'Set NEXUS_SECRET to a random 32+ character secret in your production environment ' +
                'before starting the server. The server refuses to start without it.',
              );
            }
            if (envSecret.length < 32) {
              throw new Error(
                `[Nexus Security] NEXUS_SECRET is too short (${envSecret.length} chars). ` +
                'Use at least 32 random characters (e.g. openssl rand -base64 32).',
              );
            }
          }

          try {
            nexusVault.seedFromProcessEnv();
            await preloadRegisteredServerActions(opts.root, dev);
            refreshShieldAllowlist(opts.root, dev);
          } catch (err) {
            console.error('[Nexus] Server action preload failed:', err);
          }
          // Pre-warm the aggregated CSS cache in dev mode so that the very
          // first page load (and Cmd+R with "Disable cache" in DevTools) does
          // not stall waiting for CSS compilation.  The build runs in the
          // background — listen() resolves immediately while the CSS compiles
          // concurrently.  Any errors are swallowed; the first CSS request
          // will fall back to a normal on-demand build.
          if (dev) {
            buildAggregatedNxStylesheet(opts.root).catch(() => { /* non-fatal */ });
          }
          server.listen(port, () => resolve());
        })().catch(reject);
      });
    },

    /** Re-scans src/routes — called on file changes in dev mode. */
    async reload(): Promise<void> {
      bumpDevReloadGeneration();
      bustAggregatedStylesCache();
      manifest = await buildRouteManifest(routesDir);
      if (dev) {
        await preloadRegisteredServerActions(opts.root, true);
        refreshShieldAllowlist(opts.root, true);
        // Pre-warm the aggregated CSS cache BEFORE telling the browser to reload.
        // Without this, the sequence is:
        //   1. bustAggregatedStylesCache() empties the cache
        //   2. broadcastDevHotReload() triggers location.reload() in the browser
        //   3. Browser fetches HTML (fast) then immediately requests /_nexus/styles.css
        //   4. Cache is empty → server must recompile all .nx files (slow, 50-200ms)
        //   5. HTML paints first → FOUC until CSS arrives
        //
        // By awaiting the CSS build here, the cache is warm before the browser
        // reloads.  Step 4 becomes an instant cache-hit → styles apply before
        // first paint, eliminating the flash of unstyled content.
        try {
          await buildAggregatedNxStylesheet(opts.root);
        } catch {
          // CSS build failures are non-fatal — the browser will just get
          // whatever partial CSS the next request produces.
        }
        broadcastDevHotReload();
      }
    },

    close(): void {
      server.close();
    },

    get port() { return port; },
  };
}

// ── Adapters ────────────────────────────────────────────────────────────────

function nodeToWebRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(url, { method: req.method ?? 'GET', headers });
}

/** Full body (for POST server actions — `nodeToWebRequest` omits the stream). */
async function incomingMessageToWebRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  const method = req.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (raw.length > 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    init.body = new Uint8Array(raw);
  }
  return new Request(url, init);
}

type HeaderMerge = (
  h: Record<string, string | string[] | number | undefined>,
) => Record<string, string | string[] | number>;

async function webToNodeResponse(
  response: Response,
  res: ServerResponse,
  mergeHeaders?: HeaderMerge,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  const merged = mergeHeaders ? mergeHeaders(headers) : headers;
  res.writeHead(response.status, merged);
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

async function serveStatic(
  pathname: string,
  publicDir: string,
): Promise<{ content: Buffer; mime: string } | null> {
  const root = resolve(publicDir);
  const safePath = resolve(join(root, pathname.replace(/^\/+/, '')));
  // Prevent path-traversal: resolved path must be inside publicDir
  if (safePath !== root && !safePath.startsWith(root + sep)) return null;
  try {
    const info = await stat(safePath);
    if (!info.isFile()) return null;
    const content = await readFile(safePath);
    const mime = MIME_TYPES[extname(safePath)] ?? 'application/octet-stream';
    return { content, mime };
  } catch {
    return null;
  }
}

function serverErrorPage(err: unknown, dev: boolean): string {
  return devErrorHtmlPage({ context: '500 — unhandled', err, dev });
}

function notFoundPage(pathname: string, dev: boolean): string {
  return `<!DOCTYPE html><html><body style="font-family:monospace;padding:2rem;background:#0a0a0f;color:#e8e8f0">
    <h1 style="color:#00d4aa">◆ Nexus — 404</h1>
    <p>No route found for <code style="color:#ff3e00">${pathname}</code></p>
    ${dev ? `<p style="color:#6b6b80">Add a file at <code>src/routes${pathname}/+page.nx</code> to create this page.</p>` : ''}
  </body></html>`;
}
