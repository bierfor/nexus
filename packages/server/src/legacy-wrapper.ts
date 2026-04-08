/**
 * @nexus_js/server - Legacy Action Wrapper
 * 
 * Wrap Express/Connect middleware and route handlers as Nexus Server Actions.
 * Use this to migrate existing business logic incrementally.
 */

import type { NexusContext } from './context.js';
import { IncomingMessage, ServerResponse } from 'node:http';

export type ExpressMiddleware = (
  req: IncomingMessage & { body?: unknown; params?: Record<string, string> },
  res: ServerResponse & {
    json?: (data: unknown) => void;
    status?: (code: number) => ServerResponse;
  },
  next: (err?: unknown) => void,
) => void;

/**
 * Wrap an Express/Connect middleware as a Nexus Server Action.
 * 
 * The middleware's `req.body` is populated from the FormData/JSON action payload.
 * The middleware's `res.json(data)` returns `{ data }` to the client.
 * Calling `next(err)` returns `{ error: err.message, status: 500 }`.
 * 
 * @example
 * ```ts
 * // Old Express route:
 * app.post('/api/legacy-payment', legacyPaymentMiddleware);
 * 
 * // Wrap as Nexus action:
 * export const legacyPayment = wrapExpressMiddleware(legacyPaymentMiddleware);
 * 
 * // Now callable from Nexus:
 * <form method="post" action="/_nexus/action/legacyPayment">
 *   <input name="amount" />
 *   <button type="submit">Pay</button>
 * </form>
 * ```
 */
export function wrapExpressMiddleware(middleware: ExpressMiddleware) {
  return async function wrappedAction(formData: FormData, ctx: NexusContext) {
    // Build a mock Express req/res
    const mockReq: IncomingMessage & {
      body?: unknown;
      params?: Record<string, string>;
      headers: Record<string, string>;
      method: string;
      url: string;
    } = Object.assign(Object.create(IncomingMessage.prototype), {
      body: Object.fromEntries(formData.entries()),
      params: ctx.params,
      headers: Object.fromEntries((ctx as { request?: { headers?: Headers } }).request?.headers?.entries() ?? []),
      method: 'POST',
      url: (ctx as { request?: { url?: string } }).request?.url ?? '/_nexus/action',
    });

    let responseData: unknown = null;
    let responseStatus = 200;
    let errorMessage: string | null = null;

    const mockRes: ServerResponse & {
      json?: (data: unknown) => void;
      status?: (code: number) => ServerResponse;
    } = Object.assign(Object.create(ServerResponse.prototype), {
      json: (data: unknown) => {
        responseData = data;
      },
      status: (code: number) => {
        responseStatus = code;
        return mockRes;
      },
      writeHead: () => {},
      end: () => {},
    });

    const next = (err?: unknown) => {
      if (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        responseStatus = 500;
      }
    };

    // Run middleware
    try {
      await new Promise<void>((resolve) => {
        middleware(mockReq, mockRes, (err) => {
          next(err);
          resolve();
        });
        // If middleware doesn't call next, assume success after microtask
        queueMicrotask(resolve);
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      responseStatus = 500;
    }

    if (errorMessage) {
      return { error: errorMessage, status: responseStatus };
    }

    return responseData ? { data: responseData } : {};
  };
}

/**
 * Wrap a callback-style Express route handler as a Nexus Server Action.
 * 
 * @example
 * ```ts
 * // Old Express route:
 * app.get('/api/users/:id', (req, res) => {
 *   const user = db.users.find(req.params.id);
 *   res.json({ user });
 * });
 * 
 * // Wrap as Nexus action:
 * export const getUser = wrapExpressHandler((req, res) => {
 *   const user = db.users.find(req.params.id);
 *   res.json({ user });
 * });
 * ```
 */
export function wrapExpressHandler(
  handler: (
    req: IncomingMessage & { body?: unknown; params?: Record<string, string> },
    res: ServerResponse & { json?: (data: unknown) => void; status?: (code: number) => ServerResponse },
  ) => void | Promise<void>,
) {
  return wrapExpressMiddleware((req, res, next) => {
    Promise.resolve(handler(req, res)).then(
      () => next(),
      (err) => next(err),
    );
  });
}
