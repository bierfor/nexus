/**
 * Nexus Connect — Server-Sent Events handler.
 *
 * Returns a streaming Response that stays open until the client disconnects.
 * Works with any Web-standard Request/Response environment (Node 18+, Bun, Deno, Cloudflare Workers).
 *
 * SSE wire format:
 *   id: <message-id>\n
 *   event: message\n
 *   data: <json-payload>\n\n
 *
 *   : heartbeat\n\n   ← keep-alive comment (every 15s)
 */

import { broker, type ConnectMessage } from './broker.js';

const HEARTBEAT_MS  = 15_000;
export const CONNECT_PATH = '/_nexus/connect/';

export interface ConnectSseOptions {
  cors?: {
    allowOrigin?: string;
  };
}

/** Extract the topic name from a /_nexus/connect/:topic URL. */
export function topicFromUrl(url: URL): string {
  return decodeURIComponent(url.pathname.slice(CONNECT_PATH.length));
}

/** Returns true if this request should be handled by Nexus Connect. */
export function isConnectRequest(url: URL): boolean {
  return url.pathname.startsWith(CONNECT_PATH) && url.pathname.length > CONNECT_PATH.length;
}

/**
 * Creates a streaming SSE Response for the given topic.
 * The response stays open until the client disconnects (request.signal aborts).
 */
export function handleSSERequest(request: Request, topic: string, opts: ConnectSseOptions = {}): Response {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();

  const send = (chunk: string): void => {
    writer.write(encoder.encode(chunk)).catch(() => {});
  };

  // Initial handshake event
  send(`event: connected\ndata: ${JSON.stringify({ topic, ts: Date.now() })}\n\n`);

  // Subscribe and forward broker messages to the stream
  const unsubscribe = broker.subscribe<unknown>(topic, (msg: ConnectMessage<unknown>) => {
    send(`id: ${msg.id}\nevent: message\ndata: ${JSON.stringify(msg.data)}\n\n`);
  });

  // Heartbeat — prevents proxies from closing idle connections
  const heartbeat = setInterval(() => {
    send(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  // Cleanup when client disconnects
  request.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    unsubscribe();
    writer.close().catch(() => {});
  }, { once: true });

  return new Response(readable, {
    status: 200,
    headers: {
      'content-type':              'text/event-stream; charset=utf-8',
      'cache-control':             'no-cache, no-transform',
      'connection':                'keep-alive',
      'x-accel-buffering':         'no',
      'access-control-allow-origin': opts.cors?.allowOrigin ?? '*',
    },
  });
}

/**
 * Node.js adapter — writes SSE directly to a ServerResponse.
 * Use this when you cannot return a Web Response (e.g. in http.createServer callbacks).
 */
export function handleSSERequestNode(
  req: { signal?: AbortSignal; on?: (event: string, fn: () => void) => void },
  res: { writeHead: (s: number, h: Record<string, string>) => void; write: (s: string) => boolean; end: () => void },
  topic: string,
  opts: ConnectSseOptions = {},
): void {
  res.writeHead(200, {
    'content-type':              'text/event-stream; charset=utf-8',
    'cache-control':             'no-cache',
    'connection':                'keep-alive',
    'x-accel-buffering':         'no',
    'access-control-allow-origin': opts.cors?.allowOrigin ?? '*',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ topic, ts: Date.now() })}\n\n`);

  const unsubscribe = broker.subscribe<unknown>(topic, (msg: ConnectMessage<unknown>) => {
    res.write(`id: ${msg.id}\nevent: message\ndata: ${JSON.stringify(msg.data)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on?.('close', cleanup);
  req.signal?.addEventListener('abort', cleanup, { once: true });
}
