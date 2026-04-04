/**
 * Nexus Server — Node.js HTTP server adapter.
 * Handles SSR, static assets, Server Actions and dev HMR.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { buildRouteManifest, matchRoute } from '@nexus_js/router';
import type { RouteManifest } from '@nexus_js/router';
import { handleActionRequest } from './actions.js';
import { handleSSERequestNode, isConnectRequest, topicFromUrl } from '@nexus_js/connect';
import {
  buildAggregatedNxStylesheet,
  bustAggregatedStylesCache,
  compileIslandClientBundle,
  isIslandClientRequest,
  tryServeRuntimeAsset,
} from './dev-assets.js';
import { devErrorHtmlPage } from './dev-error-html.js';
import { broadcastDevHotReload, subscribeDevHotClient } from './dev-hot.js';
import { renderRoute, renderRouteStreaming } from './renderer.js';
import { pipeToNodeResponse } from './streaming.js';
import { handleNavigationRequest } from './navigate.js';
import { bumpDevReloadGeneration, preloadRegisteredServerActions } from './load-module.js';
import { createContext, RedirectSignal, NotFoundSignal } from './context.js';
import type { RenderOptions } from './renderer.js';

export { STUDIO_DEFAULT_PORT } from './constants.js';
export { createAction, registerAction, ActionError } from './actions.js';
export { createContext } from './context.js';
export type { NexusContext, CookieOptions } from './context.js';
export type { RenderResult, RenderOptions } from './renderer.js';
export { mergeRoutePretext } from './renderer.js';
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
  BrainCompletionPayload,
} from './devradar.js';

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
   * From `nexus.config.ts` `security` — when `hardened: true`, HTML and API responses get baseline security headers.
   */
  security?: { hardened?: boolean };
  /**
   * Flush the HTML shell (head + skeleton) before `nxPretext` resolves — improves TTFB when Pretext is slow.
   * Fragment layouts only (route output must not be a full `&lt;html&gt;` document).
   */
  streamingPretext?: boolean;
}

/** Merge Hardened Mode headers (changelog v0.5) — CSP nonces are a future enhancement. */
function mergeHardenedHeaders(
  headers: Record<string, string | string[] | number | undefined>,
  hardened: boolean | undefined,
  dev: boolean,
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

  let manifest: RouteManifest = await buildRouteManifest(routesDir);

  const renderOpts: RenderOptions = {
    dev,
    appRoot: opts.root,
    assets: {
      /** ESM entry + chunks served from @nexus_js/runtime/dist via /_nexus/rt/* */
      runtime: '/_nexus/rt/index.js',
      styles: ['/_nexus/styles.css'],
      islands: new Map(),
    },
  };

  const sec = (h: Record<string, string | string[] | number | undefined>) =>
    mergeHardenedHeaders(h, opts.security?.hardened, dev);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const t0  = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

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
    if (dev && method === 'GET' && url.pathname === '/_nexus/dev/hot') {
      subscribeDevHotClient(req, res);
      return;
    }

    // ── Server Actions ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/_nexus/action/')) {
      _isAction = true;
      const request = await incomingMessageToWebRequest(req);
      const response = await handleActionRequest(request);
      await webToNodeResponse(response, res, sec);
      return;
    }

    // ── Nexus Connect — SSE (/_nexus/connect/:topic) ────────────────────────
    if (method === 'GET' && isConnectRequest(url)) {
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

    // ── Client island ESM (dynamic import target for <nexus-island>) ───────
    if (isIslandClientRequest(url.pathname) && method === 'GET') {
      const out = await compileIslandClientBundle(opts.root, url);
      res.writeHead(out.status, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': dev ? 'no-store' : 'public, max-age=120',
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
        const css = await buildAggregatedNxStylesheet(opts.root);
        res.writeHead(200, {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': dev ? 'no-store' : 'public, max-age=300',
        });
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
      res.writeHead(404, sec({ 'content-type': 'text/html' }));
      res.end(notFoundPage(url.pathname, dev));
      return;
    }

    const request = nodeToWebRequest(req);
    const ctx = createContext(request, matched.params);

    try {
      if (opts.streamingPretext === true && method === 'GET') {
        _cacheStrategy = 'streaming-no-store';
        const streamRes = renderRouteStreaming(matched, ctx, renderOpts);
        await pipeToNodeResponse(streamRes, res, sec);
        return;
      }

      const result = await renderRoute(matched, ctx, renderOpts);
      _cacheStrategy = result.headers['x-nexus-cache-strategy'];
      res.writeHead(result.status, sec(result.headers as Record<string, string | string[] | number | undefined>));
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
          try {
            await preloadRegisteredServerActions(opts.root, dev);
          } catch (err) {
            console.error('[Nexus] Server action preload failed:', err);
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
  const safePath = join(publicDir, pathname.replace(/^\/+/, ''));
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
