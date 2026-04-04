/**
 * Dev hot-reload — Server-Sent Events so the browser refreshes after `server.reload()`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const clients = new Set<ServerResponse>();

export function subscribeDevHotClient(req: IncomingMessage, res: ServerResponse): void {
  req.socket.setTimeout(0);
  res.writeHead(200, {
    'content-type':        'text/event-stream; charset=utf-8',
    'cache-control':       'no-cache, no-transform',
    connection:            'keep-alive',
    'x-accel-buffering':   'no',
  });
  res.write(': nexus dev hot\n\n');
  clients.add(res);
  const done = () => {
    clients.delete(res);
  };
  res.on('close', done);
  req.on('close', done);
}

/** Notify every open tab to reload (after route manifest / caches refresh). */
export function broadcastDevHotReload(): void {
  const chunk = 'event: reload\ndata: {}\n\n';
  for (const res of [...clients]) {
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
    }
  }
}
