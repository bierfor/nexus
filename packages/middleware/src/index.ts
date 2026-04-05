/**
 * Nexus Middleware — Web-standard request pipeline.
 *
 * 100% based on `Request` / `Response` — runs identically on:
 *   - Node.js 22+
 *   - Bun
 *   - Deno
 *   - Cloudflare Workers
 *   - Vercel Edge Runtime
 *   - Netlify Edge Functions
 *
 * Usage in src/middleware.ts:
 *   import { defineMiddleware, sequence, auth, cors, rateLimit } from '@nexus_js/middleware';
 *
 *   export default defineMiddleware(
 *     sequence(
 *       cors({ origins: ['https://myapp.com'] }),
 *       rateLimit({ max: 100, window: 60 }),
 *       auth({ public: ['/login', '/register'] }),
 *     )
 *   );
 */

export type MiddlewareFn = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response> | Response;

export type Middleware = MiddlewareFn;

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Defines the middleware entry point.
 * Export this from `src/middleware.ts`.
 */
export function defineMiddleware(fn: MiddlewareFn): MiddlewareFn {
  return fn;
}

/**
 * Composes multiple middlewares into a single pipeline.
 * They run left-to-right.
 */
export function sequence(...middlewares: MiddlewareFn[]): MiddlewareFn {
  return async (request, next) => {
    let index = -1;

    const dispatch = async (i: number): Promise<Response> => {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;

      const fn = middlewares[i];
      if (!fn) return next();

      return fn(request, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}

// ── Built-in Middlewares ───────────────────────────────────────────────────────

export interface CORSOptions {
  /** Allowed origins. Use '*' for any. Default: '*' */
  origins?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * CORS middleware — handles preflight and injects CORS headers.
 */
export function cors(opts: CORSOptions = {}): MiddlewareFn {
  const allowedMethods = (opts.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).join(', ');
  const allowedHeaders = (opts.headers ?? ['Content-Type', 'Authorization', 'X-Nexus-Action']).join(', ');

  return async (request, next) => {
    const origin = request.headers.get('origin') ?? '';

    const isAllowed = (() => {
      const o = opts.origins ?? '*';
      if (o === '*') return true;
      if (typeof o === 'function') return o(origin);
      if (Array.isArray(o)) return o.includes(origin);
      return o === origin;
    })();

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': isAllowed ? origin || '*' : '',
          'access-control-allow-methods': allowedMethods,
          'access-control-allow-headers': allowedHeaders,
          'access-control-max-age': String(opts.maxAge ?? 86400),
          ...(opts.credentials ? { 'access-control-allow-credentials': 'true' } : {}),
        },
      });
    }

    const response = await next();
    const headers = new Headers(response.headers);

    if (isAllowed) {
      headers.set('access-control-allow-origin', origin || '*');
      if (opts.credentials) headers.set('access-control-allow-credentials', 'true');
    }

    return new Response(response.body, { status: response.status, headers });
  };
}

export interface RateLimitOptions {
  /** Max requests per window */
  max: number;
  /** Window size in seconds */
  window: number;
  /** Key function to identify clients (default: IP-based) */
  keyFn?: (request: Request) => string;
  /** Message returned when rate limited */
  message?: string;
}

/** In-memory rate limit store (use Redis adapter in production) */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Rate limiting middleware using a sliding window algorithm.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareFn {
  return async (request, next) => {
    const key = opts.keyFn?.(request) ?? getClientIP(request);
    const now = Date.now();
    const windowMs = opts.window * 1000;

    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      const response = await next();
      return addRateLimitHeaders(response, opts.max, opts.max - 1, Math.floor((now + windowMs) / 1000));
    }

    entry.count++;

    if (entry.count > opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return new Response(opts.message ?? 'Too Many Requests', {
        status: 429,
        headers: {
          'retry-after': String(retryAfter),
          'x-ratelimit-limit': String(opts.max),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(entry.resetAt / 1000)),
          'content-type': 'text/plain',
        },
      });
    }

    const response = await next();
    return addRateLimitHeaders(
      response,
      opts.max,
      opts.max - entry.count,
      Math.floor(entry.resetAt / 1000),
    );
  };
}

export interface AuthOptions {
  /** Public paths that skip auth (supports wildcards like '/api/*') */
  public?: string[];
  /** Where to redirect unauthenticated users */
  loginUrl?: string;
  /** Custom session validator — return truthy if valid */
  validate?: (request: Request) => boolean | Promise<boolean>;
}

/**
 * Authentication guard middleware.
 * Redirects to loginUrl if the user is not authenticated.
 */
export function auth(opts: AuthOptions = {}): MiddlewareFn {
  const publicPaths = opts.public ?? [];
  const loginUrl = opts.loginUrl ?? '/login';

  return async (request, next) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if path is public
    const isPublic = publicPaths.some((p) => {
      if (p.endsWith('*')) return path.startsWith(p.slice(0, -1));
      return path === p;
    });

    if (isPublic) return next();

    // Custom validator
    if (opts.validate) {
      const valid = await opts.validate(request);
      if (valid) return next();
    } else {
      // Default: check for session cookie
      const cookie = request.headers.get('cookie') ?? '';
      if (cookie.includes('nx-session=')) return next();
    }

    // Not authenticated — redirect
    return Response.redirect(loginUrl, 302);
  };
}

export interface GeoOptions {
  /** Block requests from these country codes */
  blocked?: string[];
  /** Allow only these country codes */
  allowed?: string[];
}

/**
 * Geo-blocking middleware — uses Cloudflare/Vercel edge headers.
 */
export function geo(opts: GeoOptions): MiddlewareFn {
  return async (request, next) => {
    const country =
      request.headers.get('cf-ipcountry') ??
      request.headers.get('x-vercel-ip-country') ??
      request.headers.get('x-country-code') ??
      'XX';

    if (opts.blocked?.includes(country)) {
      return new Response('Access denied from your region.', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    }

    if (opts.allowed && !opts.allowed.includes(country)) {
      return new Response('Access denied from your region.', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    }

    return next();
  };
}

/**
 * Security headers middleware — HSTS, CSP, X-Frame-Options, etc.
 */
export function securityHeaders(opts: {
  csp?: string;
  hsts?: boolean;
  noSniff?: boolean;
  frameOptions?: 'DENY' | 'SAMEORIGIN';
} = {}): MiddlewareFn {
  return async (request, next) => {
    const response = await next();
    const headers = new Headers(response.headers);

    if (opts.hsts !== false) {
      headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    if (opts.noSniff !== false) {
      headers.set('x-content-type-options', 'nosniff');
    }
    if (opts.frameOptions !== undefined) {
      headers.set('x-frame-options', opts.frameOptions);
    }
    if (opts.csp) {
      headers.set('content-security-policy', opts.csp);
    }

    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');

    return new Response(response.body, { status: response.status, headers });
  };
}

/**
 * Request logger middleware — logs method, path, status and duration.
 */
export function logger(opts: { format?: 'tiny' | 'combined' } = {}): MiddlewareFn {
  return async (request, next) => {
    const start = Date.now();
    const url = new URL(request.url);
    const response = await next();
    const ms = Date.now() - start;

    const status = response.status;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(
      `  ${color}${status}\x1b[0m ${request.method} ${url.pathname} \x1b[2m${ms}ms\x1b[0m`,
    );

    return response;
  };
}

// ── Edge adapter factory ───────────────────────────────────────────────────────

/**
 * Wraps the Nexus middleware pipeline in a Cloudflare Worker handler.
 */
export function toCloudflareHandler(middleware: MiddlewareFn) {
  return {
    async fetch(request: Request, env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
      return middleware(request, () => Promise.resolve(new Response('Not Found', { status: 404 })));
    },
  };
}

/**
 * Wraps the middleware for Vercel Edge Functions.
 */
export function toVercelEdge(middleware: MiddlewareFn) {
  return async (request: Request): Promise<Response> => {
    return middleware(request, () => Promise.resolve(new Response('Not Found', { status: 404 })));
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getClientIP(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function addRateLimitHeaders(
  response: Response,
  limit: number,
  remaining: number,
  reset: number,
): Response {
  const headers = new Headers(response.headers);
  headers.set('x-ratelimit-limit', String(limit));
  headers.set('x-ratelimit-remaining', String(Math.max(0, remaining)));
  headers.set('x-ratelimit-reset', String(reset));
  return new Response(response.body, { status: response.status, headers });
}
