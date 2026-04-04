/**
 * Nexus Server — Node.js HTTP server adapter.
 * Handles SSR, static assets, Server Actions and dev HMR.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { buildRouteManifest, matchRoute } from '@nexus/router';
import type { RouteManifest } from '@nexus/router';
import { handleActionRequest } from './actions.js';
import { handleSSERequestNode, isConnectRequest, topicFromUrl } from '@nexus/connect';
import {
  buildAggregatedNxStylesheet,
  bustAggregatedStylesCache,
  compileIslandClientBundle,
  isIslandClientRequest,
  tryServeRuntimeAsset,
} from './dev-assets.js';
import { renderRoute } from './renderer.js';
import { reimportDevActionSidecars } from './load-module.js';
import { createContext, RedirectSignal, NotFoundSignal } from './context.js';
import type { RenderOptions } from './renderer.js';

export { createAction, registerAction, ActionError } from './actions.js';
export { createContext } from './context.js';
export type { NexusContext, CookieOptions } from './context.js';
export type { RenderResult, RenderOptions } from './renderer.js';

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
      /** ESM entry + chunks served from @nexus/runtime/dist via /_nexus/rt/* */
      runtime: '/_nexus/rt/index.js',
      styles: ['/_nexus/styles.css'],
      islands: new Map(),
    },
  };

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

    // ── Server Actions ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/_nexus/action/')) {
      _isAction = true;
      const request = await incomingMessageToWebRequest(req);
      const response = await handleActionRequest(request);
      await webToNodeResponse(response, res);
      return;
    }

    // ── Nexus Connect — SSE (/_nexus/connect/:topic) ────────────────────────
    if (method === 'GET' && isConnectRequest(url)) {
      handleSSERequestNode(req, res, topicFromUrl(url));
      return;
    }

    // ── @nexus/runtime ESM (browser import graph: /_nexus/rt/index.js → ./island.js …)
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

    // ── Static files ────────────────────────────────────────────────────────
    const staticResult = await serveStatic(url.pathname, publicDir);
    if (staticResult) {
      res.writeHead(200, { 'content-type': staticResult.mime });
      res.end(staticResult.content);
      return;
    }

    // ── SSR routing ─────────────────────────────────────────────────────────
    const matched = matchRoute(url.pathname, manifest);
    if (!matched) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(notFoundPage(url.pathname, dev));
      return;
    }

    const request = nodeToWebRequest(req);
    const ctx = createContext(request, matched.params);

    try {
      const result = await renderRoute(matched, ctx, renderOpts);
      _cacheStrategy = result.headers['x-nexus-cache-strategy'];
      res.writeHead(result.status, result.headers);
      res.end(result.html);
    } catch (err) {
      if (err instanceof RedirectSignal) {
        res.writeHead(err.status, { location: err.location });
        res.end();
        return;
      }
      if (err instanceof NotFoundSignal) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end(notFoundPage(url.pathname, dev));
        return;
      }
      if (dev) {
        const message = err instanceof Error ? err.message : String(err);
        const stack   = err instanceof Error ? (err.stack ?? '') : '';
        console.error(`\x1b[31m[Nexus Error]\x1b[0m ${method} ${url.pathname}\n  ${message}`);
        if (stack) stack.split('\n').slice(1, 6).forEach(l => console.error(`  \x1b[2m${l.trim()}\x1b[0m`));
      } else {
        console.error('[Nexus] Unhandled error:', err);
      }
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end(serverErrorPage(err, dev));
    }
  });

  return {
    /** Starts listening. Resolves when the server is bound to the port. */
    listen(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(port, () => resolve());
      });
    },

    /** Re-scans src/routes — called on file changes in dev mode. */
    async reload(): Promise<void> {
      bustAggregatedStylesCache();
      manifest = await buildRouteManifest(routesDir);
      if (dev) {
        await reimportDevActionSidecars(opts.root);
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

async function webToNodeResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  const body = await response.text();
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
  const message = err instanceof Error ? err.message : String(err);
  const stack   = dev && err instanceof Error ? (err.stack ?? '') : '';
  return `<!DOCTYPE html><html lang="en"><body style="font-family:monospace;padding:2rem;background:#0a0a0f;color:#e8e8f0">
    <h1 style="color:#ff3e00">◆ Nexus — 500 Server Error</h1>
    <pre style="color:#ff6b6b;background:#0d0d1a;padding:1rem;border-radius:6px;overflow:auto">${message}</pre>
    ${dev && stack ? `<details open><summary style="cursor:pointer;color:#6b6b80">Stack trace</summary>
      <pre style="font-size:0.75rem;color:#4b5563">${stack.replace(/</g, '&lt;')}</pre>
    </details>` : ''}
  </body></html>`;
}

function notFoundPage(pathname: string, dev: boolean): string {
  return `<!DOCTYPE html><html><body style="font-family:monospace;padding:2rem;background:#0a0a0f;color:#e8e8f0">
    <h1 style="color:#00d4aa">◆ Nexus — 404</h1>
    <p>No route found for <code style="color:#ff3e00">${pathname}</code></p>
    ${dev ? `<p style="color:#6b6b80">Add a file at <code>src/routes${pathname}/+page.nx</code> to create this page.</p>` : ''}
  </body></html>`;
}
