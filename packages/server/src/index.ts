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
import { renderRoute } from './renderer.js';
import { createContext, RedirectSignal, NotFoundSignal } from './context.js';
import type { RenderOptions } from './renderer.js';

export { createAction, registerAction, ActionError } from './actions.js';
export { createContext } from './context.js';
export type { NexusContext, CookieOptions } from './context.js';
export type { RenderResult, RenderOptions } from './renderer.js';

export interface NexusServerOptions {
  /** Root directory of the Nexus app */
  root: string;
  /** Port to listen on */
  port?: number;
  /** Enable dev mode (HMR, verbose errors) */
  dev?: boolean;
  /** Static assets directory */
  publicDir?: string;
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
    assets: {
      runtime: '/_nexus/runtime.js',
      styles: ['/_nexus/styles.css'],
      islands: new Map(),
    },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    // ── Server Actions ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/_nexus/action/')) {
      const request = nodeToWebRequest(req);
      const response = await handleActionRequest(request);
      await webToNodeResponse(response, res);
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
      console.error('[Nexus] Unhandled error:', err);
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<h1>500 — Internal Server Error</h1>');
    }
  });

  return {
    listen() {
      server.listen(port, () => {
        console.log(`\n  \x1b[36m◆ Nexus\x1b[0m running at \x1b[1mhttp://localhost:${port}\x1b[0m`);
        if (dev) console.log(`  \x1b[33m⚡ Dev mode\x1b[0m — HMR enabled`);
        console.log('');
      });
    },

    async reload() {
      manifest = await buildRouteManifest(routesDir);
    },

    close() {
      server.close();
    },
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

function notFoundPage(pathname: string, dev: boolean): string {
  return `<!DOCTYPE html><html><body style="font-family:monospace;padding:2rem;background:#0a0a0f;color:#e8e8f0">
    <h1 style="color:#00d4aa">◆ Nexus — 404</h1>
    <p>No route found for <code style="color:#ff3e00">${pathname}</code></p>
    ${dev ? `<p style="color:#6b6b80">Add a file at <code>src/routes${pathname}/+page.nx</code> to create this page.</p>` : ''}
  </body></html>`;
}
