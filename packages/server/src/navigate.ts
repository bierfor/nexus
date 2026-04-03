/**
 * Nexus Navigation Server Handler
 *
 * Responds to /_nexus/navigate?path=... requests from the client router.
 * Returns a JSON payload with the new page's HTML and metadata,
 * optimized for the DOM morphing algorithm.
 */

import { matchRoute } from '@nexus/router';
import type { RouteManifest } from '@nexus/router';
import { createContext } from './context.js';
import { renderRoute } from './renderer.js';
import type { RenderOptions } from './renderer.js';

export interface NavigationPayload {
  html: string;
  headHTML: string;
  islandManifest: Array<{ id: string; componentPath: string; strategy: string }>;
  timestamp: number;
}

export async function handleNavigationRequest(
  request: Request,
  manifest: RouteManifest,
  renderOpts: RenderOptions,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') ?? '/';

  const matched = matchRoute(path, manifest);

  if (!matched) {
    return new Response(
      JSON.stringify({ error: 'Route not found', path }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
  }

  // Create a mock request for the target path
  const targetRequest = new Request(
    new URL(path, request.url).href,
    { headers: request.headers },
  );
  const ctx = createContext(targetRequest, matched.params);

  try {
    const result = await renderRoute(matched, ctx, renderOpts);

    // Extract <head> content from the full HTML
    const headMatch = /<head>([\s\S]*?)<\/head>/i.exec(result.html);
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(result.html);

    const payload: NavigationPayload = {
      html: bodyMatch?.[1]?.trim() ?? result.html,
      headHTML: headMatch?.[1]?.trim() ?? '',
      islandManifest: [],
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
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
