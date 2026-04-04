/**
 * Nexus Streaming SSR — Out-of-order HTML flushing with Suspense boundaries.
 *
 * How it works:
 *
 *   1. The route render function returns immediately with the static shell.
 *      Any Promise in the template becomes a placeholder:
 *        <template id="nx-hole-3a9f"></template>
 *
 *   2. The HTTP connection stays OPEN (Transfer-Encoding: chunked).
 *      The browser receives and paints the static shell instantly.
 *
 *   3. When each Promise resolves, the server writes two chunks:
 *      a) The resolved HTML wrapped in a <template id="nx-fill-3a9f">
 *      b) A tiny inline script that moves the template content
 *         to the hole's position and removes both elements.
 *
 *   4. Error boundary: if a Promise rejects, the server writes the
 *      error.nx fallback HTML instead.
 *
 * Result: Users see content as it becomes available, not all-at-once.
 *         The Time-to-First-Byte is the server's fastest possible response.
 *
 * Wire format (chunks sent over HTTP):
 *   Chunk 1: Full HTML with placeholders
 *     <div>Static content</div>
 *     <template id="nx-hole-3a9f" data-nx-fallback="<p>Loading...</p>"></template>
 *     <template id="nx-hole-7b2c"></template>
 *
 *   Chunk 2: Resolved content (arrives async)
 *     <template id="nx-fill-3a9f"><article>...</article></template>
 *     <script>__nx_fill("3a9f")</script>
 *
 *   Chunk 3: Another resolution or error boundary
 *     <template id="nx-fill-7b2c"><div class="error">...</div></template>
 *     <script>__nx_fill("7b2c")</script>
 *
 *   Final chunk (closes stream):
 *     <script>__nx_stream_complete()</script>
 */

import { encodeChunk } from '@nexus_js/serialize';

export interface StreamingBoundary {
  id: string;
  /** The promise that will resolve to HTML */
  promise: Promise<string>;
  /** Fallback HTML shown while loading */
  fallback?: string;
  /** Error boundary HTML (overrides error.nx at component level) */
  errorFallback?: string;
}

export interface StreamController {
  /** Write the initial HTML shell (immediately) */
  writeShell: (html: string) => void;
  /** Register a deferred content promise */
  defer: (boundary: StreamingBoundary) => void;
  /** Signal stream completion */
  close: () => void;
}

/** Bootstrap script injected once per page */
const BOOTSTRAP_SCRIPT = `<script id="__nx_stream_boot__">
(function(){
  function __nx_fill(id){
    var fill=document.getElementById('nx-fill-'+id);
    var hole=document.getElementById('nx-hole-'+id);
    if(fill&&hole){
      hole.replaceWith(fill.content.cloneNode(true));
      fill.remove();
    }
  }
  function __nx_fill_error(id,html){
    var hole=document.getElementById('nx-hole-'+id);
    if(hole){var d=document.createElement('div');d.innerHTML=html;hole.replaceWith(d);}
  }
  function __nx_stream_complete(){
    document.dispatchEvent(new Event('nexus:stream-complete'));
  }
  window.__nx_fill=__nx_fill;
  window.__nx_fill_error=__nx_fill_error;
  window.__nx_stream_complete=__nx_stream_complete;
})();
</script>`;

/**
 * Creates a streaming SSR response.
 * Returns a Web-standard `ReadableStream` for use in any edge runtime.
 */
export function createStreamingResponse(
  renderFn: (ctrl: StreamController) => void | Promise<void>,
  opts: {
    headers?: HeadersInit;
    onError?: (err: unknown) => string;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const pending: StreamingBoundary[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      controller = ctrl;
    },
  });

  const write = (html: string): void => {
    controller.enqueue(encoder.encode(html));
  };

  const streamCtrl: StreamController = {
    writeShell(html) {
      // Inject bootstrap script before </head>
      const injected = html.replace('</head>', `${BOOTSTRAP_SCRIPT}\n</head>`);
      write(injected);
    },

    defer(boundary) {
      pending.push(boundary);
    },

    close() {
      write('<script>__nx_stream_complete()</script>');
      controller.close();
    },
  };

  // Start rendering
  const work = async (): Promise<void> => {
    try {
      await renderFn(streamCtrl);

      // Resolve all pending boundaries in parallel
      const tasks = pending.map(async (boundary) => {
        try {
          const html = await boundary.promise;
          write(buildFillChunk(boundary.id, html));
        } catch (err) {
          const errorHtml =
            boundary.errorFallback ??
            opts.onError?.(err) ??
            buildDefaultErrorHTML(err);
          write(buildErrorChunk(boundary.id, errorHtml));
        }
      });

      await Promise.all(tasks);
      streamCtrl.close();
    } catch (err) {
      write(buildFatalErrorChunk(err));
      controller.close();
    }
  };

  work();

  const headers = new Headers(opts.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('transfer-encoding', 'chunked');
  headers.set('x-content-type-options', 'nosniff');
  // Signal to CDN that this is a streaming response
  headers.set('cache-control', 'no-store');

  return new Response(stream, { status: 200, headers });
}

/**
 * Template tag for deferred content in .nx templates.
 *
 * Usage in template:
 *   {#await fetchPosts()}
 *     <p>Loading posts...</p>
 *   {:then posts}
 *     {#each posts as p}<article>{p.title}</article>{/each}
 *   {:catch error}
 *     <p class="error">{error.message}</p>
 *   {/await}
 *
 * Compiled output:
 *   createSuspenseBoundary(fetchPosts(), {
 *     fallback: '<p>Loading posts...</p>',
 *     render: (posts) => posts.map(...).join(''),
 *   })
 */
export function createSuspenseBoundary<T>(
  promise: Promise<T>,
  opts: {
    fallback?: string;
    render: (value: T) => string;
    errorFallback?: string | ((err: unknown) => string);
  },
): { id: string; placeholder: string; boundary: StreamingBoundary } {
  const id = generateBoundaryId();

  const placeholder = `<template id="nx-hole-${id}"${
    opts.fallback ? ` data-nx-fallback="${htmlEscape(opts.fallback)}"` : ''
  }></template>`;

  const boundary: StreamingBoundary = {
    id,
    promise: promise.then((value) => opts.render(value)),
  };
  if (opts.fallback !== undefined) {
    boundary.fallback = opts.fallback;
  }
  const ef = typeof opts.errorFallback !== 'function' ? opts.errorFallback : undefined;
  if (ef !== undefined) {
    boundary.errorFallback = ef;
  }

  return { id, placeholder, boundary };
}

// ── Node.js adapter ───────────────────────────────────────────────────────────

/**
 * Pipes a streaming response to a Node.js `ServerResponse`.
 * Used by the Node.js server adapter.
 */
export async function pipeToNodeResponse(
  webResponse: Response,
  nodeRes: import('node:http').ServerResponse,
): Promise<void> {
  nodeRes.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => nodeRes.setHeader(key, value));

  if (!webResponse.body) {
    nodeRes.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(value);
    }
  } finally {
    nodeRes.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildFillChunk(id: string, html: string): string {
  return (
    `<template id="nx-fill-${id}">${html}</template>` +
    `<script>__nx_fill("${id}")</script>`
  );
}

function buildErrorChunk(id: string, html: string): string {
  return (
    `<template id="nx-fill-${id}">${html}</template>` +
    `<script>__nx_fill("${id}")</script>`
  );
}

function buildFatalErrorChunk(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `<script>console.error('[Nexus Stream] Fatal error:', ${JSON.stringify(msg)})</script>`;
}

function buildDefaultErrorHTML(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `<div data-nx-error style="color:red;padding:1rem;border:1px solid red;border-radius:4px">
    <strong>Error</strong>: ${htmlEscape(msg)}
  </div>`;
}

let _counter = 0;
function generateBoundaryId(): string {
  _counter = (_counter + 1) % 0xffff;
  return (_counter + Date.now()).toString(16).slice(-6);
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
