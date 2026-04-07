/**
 * Nexus Navigation Server Handler
 *
 * Responds to /_nexus/navigate?path=... requests from the client router.
 * Returns a JSON payload with the new page's HTML and metadata,
 * optimized for the DOM morphing algorithm.
 */

import { matchRoute } from '@nexus_js/router';
import type { RouteManifest } from '@nexus_js/router';
import { createContext, NotFoundSignal, RedirectSignal } from './context.js';
import { renderRoute } from './renderer.js';
import type { RenderOptions } from './renderer.js';

export interface NavigationPayload {
  html: string;
  headHTML: string;
  timestamp: number;
}

export async function handleNavigationRequest(
  request: Request,
  manifest: RouteManifest,
  renderOpts: RenderOptions,
): Promise<Response> {
  const reqUrl = new URL(request.url);
  const rawPath = reqUrl.searchParams.get('path') ?? '/';

  /** Resolve `path` query (may include ?query and #hash) against site origin — not against /_nexus/navigate. */
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawPath, new URL(`${reqUrl.origin}/`));
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid path', path: rawPath }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  if (targetUrl.origin !== reqUrl.origin) {
    return new Response(
      JSON.stringify({ error: 'Only same-origin paths are allowed' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const pathname = targetUrl.pathname || '/';
  const matched = matchRoute(pathname, manifest);

  if (!matched) {
    return new Response(
      JSON.stringify({ error: 'Route not found', path: pathname, rawPath }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
  }

  // Full URL (search + hash) so ctx.url matches a normal visit (?lang=, etc.)
  const targetRequest = new Request(targetUrl.href, { headers: request.headers });
  const ctx = createContext(targetRequest, matched.params);

  try {
    const result = await renderRoute(matched, ctx, renderOpts);

    // Extract inner HTML — use last closing tag so </body> inside scripts doesn't truncate.
    const headHTML = extractHeadInnerHtml(result.html);
    const bodyHTML = extractBodyInnerHtml(result.html);

    const payload: NavigationPayload = {
      html: bodyHTML,
      headHTML,
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-nexus-navigate': '1',
      },
    });
  } catch (err) {
    if (err instanceof NotFoundSignal) {
      return new Response(JSON.stringify({ error: 'not_found', path: pathname }), {
        status: 404,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-nexus-navigate': '1',
        },
      });
    }
    if (err instanceof RedirectSignal) {
      // Forward Set-Cookie (e.g. logout clearing pf_admin_token) — was missing so SPA sign-out never cleared the cookie.
      const headers = new Headers({
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-nexus-navigate': '1',
      });
      err.responseHeaders.forEach((value, key) => {
        headers.append(key, value);
      });
      return new Response(
        JSON.stringify({ redirect: err.location, status: err.status }),
        {
          status: 200,
          headers,
        },
      );
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}

/** Inner HTML of first <head>…</head> using the last </head> (avoids greedy/non-greedy traps). */
function extractHeadInnerHtml(html: string): string {
  const m = /<head[^>]*>/i.exec(html);
  if (!m || m.index === undefined) return '';
  const start = m.index + m[0].length;
  const lower = html.toLowerCase();
  const closeIdx = lower.lastIndexOf('</head>');
  if (closeIdx === -1 || closeIdx <= start) return '';
  return html.slice(start, closeIdx).trim();
}

/** Inner HTML of first <body>…</body> using the last </body>. */
function extractBodyInnerHtml(html: string): string {
  const m = /<body[^>]*>/i.exec(html);
  if (!m || m.index === undefined) return html;
  const start = m.index + m[0].length;
  const lower = html.toLowerCase();
  const closeIdx = lower.lastIndexOf('</body>');
  if (closeIdx === -1 || closeIdx <= start) return html.slice(start).trim();
  return html.slice(start, closeIdx).trim();
}
