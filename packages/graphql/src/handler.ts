/**
 * Nexus GraphQL Handler — createGraphQLHandler()
 *
 * Returns a (request: Request, ctx: NexusContext) → Promise<Response> function
 * compatible with the Nexus server `mounts` option.
 *
 * What this handler does
 * ──────────────────────
 *  1. Handles CORS preflight (OPTIONS) so browser clients don't get blocked.
 *     Important: Nexus's own CSP/security headers are added by the server on
 *     top — we never fight over the same header names.
 *
 *  2. Parses and validates the incoming GraphQL request (GET, POST JSON,
 *     POST application/graphql) — no Express, no middleware.
 *
 *  3. Rejects introspection in production mode (configurable).
 *
 *  4. Runs the Shield complexity & depth analysis on the parsed AST *before*
 *     calling execute() — saves CPU on malicious queries.
 *
 *  5. Calls graphql.execute() with the context you provide.
 *
 *  6. Applies field masking on the result.
 *
 *  7. Limits per-operation request rate using the built-in rate-limit helpers.
 *
 * Usage (in nexus.config.ts / server startup)
 * ─────────────────────────────────────────────
 *  import { createGraphQLHandler } from '@nexus_js/graphql';
 *  import { schema } from './graphql/schema.js';
 *  import { createBatchLoader } from '@nexus_js/graphql';
 *
 *  const gqlHandler = createGraphQLHandler({
 *    schema,
 *    dev: process.env.NODE_ENV !== 'production',
 *    cors: { origins: ['https://app.example.com'], credentials: true },
 *    shield: { maxCost: 500, maxDepth: 8 },
 *    mask: {
 *      'User.passwordHash': null,
 *      'PaymentCard.cvv':   'REDACTED',
 *    },
 *    context: (request, nexusCtx) => ({
 *      ...nexusCtx,
 *      loaders: {
 *        user: createBatchLoader(ids => db.users.findMany({ where: { id: { in: ids } } })),
 *      },
 *    }),
 *  });
 *
 *  // In createNexusServer():
 *  mounts: [{ path: '/graphql', handler: gqlHandler }]
 *
 * CORS notes
 * ──────────
 *  - `cors.origins: '*'` + `cors.credentials: true` is rejected (browser security requirement).
 *  - For non-CORS requests (same-origin or CLI tools) the `Access-Control-*` headers are not added.
 *  - Nexus's hardened security headers are added by the server on top; they don't override CORS.
 */

import type {
  GraphQLSchema,
  DocumentNode,
} from 'graphql';
import { analyseComplexity, type ComplexityConfig } from './complexity.js';
import { maskResult, type MaskPolicy } from './mask.js';
import type { GraphQLExecutionResult } from './mask.js';

// ── Minimal NexusContext interface (compatible with @nexus_js/server) ────────

export interface MinimalNexusContext {
  request: Request;
  secrets: ReadonlyMap<string, string>;
  locals:  Record<string, unknown>;
  [key: string]: unknown;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CorsConfig {
  /**
   * Allowed origins. Use `'*'` for open access (incompatible with `credentials: true`).
   * Can also be an array of exact origin strings, or a predicate.
   */
  origins: '*' | string[] | ((origin: string) => boolean);
  /**
   * Whether to allow cookies / auth headers.
   * Cannot be combined with `origins: '*'` — the browser will reject this.
   */
  credentials?: boolean;
  /** Extra headers allowed in the request (merged with GraphQL defaults). */
  allowHeaders?: string[];
  /** Cache preflight result for this many seconds. Default: 86400. */
  maxAge?: number;
}

export type GraphQLContextFn<Ctx = MinimalNexusContext> = (
  request: Request,
  nexusCtx: MinimalNexusContext,
) => Ctx | Promise<Ctx>;

export interface RateLimitPerOperation {
  /** Maximum requests per window. */
  max: number;
  /** Window in ms. Default: 60 000 (1 minute). */
  windowMs?: number;
}

export interface GraphQLHandlerOptions<Ctx = MinimalNexusContext> {
  /** The compiled GraphQL schema. */
  schema: GraphQLSchema;

  /**
   * `true` in dev mode:
   *  - Enables GraphiQL at the endpoint
   *  - Allows introspection regardless of `shield.allowIntrospection`
   *  - Exposes full error stack traces in responses
   */
  dev?: boolean;

  /**
   * CORS configuration. Omit to disable CORS headers (same-origin only).
   * Required when your API and frontend are on different origins.
   */
  cors?: CorsConfig;

  /**
   * Shield configuration for complexity + depth + introspection.
   * Omit to skip complexity analysis (not recommended for public APIs).
   */
  shield?: ComplexityConfig;

  /**
   * Field masking policy applied to every response.
   * See `MaskPolicy` from `@nexus_js/graphql/mask`.
   */
  mask?: MaskPolicy<Ctx>;

  /**
   * Factory to build the GraphQL execution context per request.
   * Receives the raw `Request` and the Nexus context (`ctx.secrets`, etc.).
   * Return whatever your resolvers expect on `context`.
   */
  context?: GraphQLContextFn<Ctx>;

  /**
   * Max request body size in bytes. Default: 1 MB.
   * Prevents memory exhaustion via oversized query documents.
   */
  maxBodyBytes?: number;

  /**
   * Per-IP rate limiting for the GraphQL endpoint.
   * Applies across all operations (use resolver-level limits for per-operation).
   */
  rateLimit?: RateLimitPerOperation;
}

// ── Rate limiter (minimal sliding window, no external dep) ──────────────────

interface SlidingWindow {
  timestamps: number[];
}

const rateLimitStore = new Map<string, SlidingWindow>();

function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let win = rateLimitStore.get(key);
  if (!win) {
    win = { timestamps: [] };
    rateLimitStore.set(key, win);
  }
  // Evict timestamps outside the window
  win.timestamps = win.timestamps.filter(t => t > now - windowMs);
  const resetAt = win.timestamps[0] ? win.timestamps[0] + windowMs : now + windowMs;

  if (win.timestamps.length >= max) {
    return { allowed: false, remaining: 0, resetAt };
  }
  win.timestamps.push(now);
  return { allowed: true, remaining: max - win.timestamps.length, resetAt };
}

// Prune stale rate-limit entries every 5 min to prevent unbounded growth
let _pruneTimer: ReturnType<typeof setInterval> | null = null;
function ensurePruneTimer(): void {
  if (_pruneTimer) return;
  _pruneTimer = setInterval(() => {
    const cutoff = Date.now() - 300_000;
    for (const [key, win] of rateLimitStore) {
      if (!win.timestamps.length || win.timestamps[win.timestamps.length - 1]! < cutoff) {
        rateLimitStore.delete(key);
      }
    }
  }, 300_000);
  if (_pruneTimer && typeof _pruneTimer === 'object' && 'unref' in _pruneTimer) {
    (_pruneTimer as { unref(): void }).unref();
  }
}

// ── GraphQL HTTP parsing ─────────────────────────────────────────────────────

interface ParsedGqlRequest {
  query:          string;
  variables?:     Record<string, unknown> | undefined;
  operationName?: string | undefined;
}

async function parseGqlRequest(
  request: Request,
  maxBodyBytes: number,
): Promise<ParsedGqlRequest | { error: string; status: number }> {
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const url = new URL(request.url);
    const query = url.searchParams.get('query');
    if (!query) {
      return { error: 'Missing "query" search parameter.', status: 400 };
    }
    let variables: Record<string, unknown> | undefined;
    const rawVars = url.searchParams.get('variables');
    if (rawVars) {
      try { variables = JSON.parse(rawVars) as Record<string, unknown>; }
      catch { return { error: 'Invalid JSON in "variables" parameter.', status: 400 }; }
    }
    return { query, variables, operationName: url.searchParams.get('operationName') ?? undefined };
  }

  if (method === 'POST') {
    const ct = (request.headers.get('content-type') ?? '').toLowerCase();

    // Body size guard
    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
    if (contentLength > maxBodyBytes) {
      return { error: `Request body exceeds maximum size of ${maxBodyBytes} bytes.`, status: 413 };
    }

    let rawBody: string;
    try {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > maxBodyBytes) {
        return { error: `Request body exceeds maximum size of ${maxBodyBytes} bytes.`, status: 413 };
      }
      rawBody = new TextDecoder().decode(buf);
    } catch {
      return { error: 'Failed to read request body.', status: 400 };
    }

    if (ct.includes('application/graphql')) {
      return { query: rawBody };
    }

    if (ct.includes('application/json')) {
      let body: unknown;
      try { body = JSON.parse(rawBody); }
      catch { return { error: 'Invalid JSON body.', status: 400 }; }

      if (typeof body !== 'object' || body === null) {
        return { error: 'Body must be a JSON object.', status: 400 };
      }
      const b = body as Record<string, unknown>;
      if (typeof b['query'] !== 'string') {
        return { error: 'Body must include a "query" string field.', status: 400 };
      }
      let variables: Record<string, unknown> | undefined;
      if (b['variables'] !== undefined && b['variables'] !== null) {
        if (typeof b['variables'] !== 'object') {
          return { error: '"variables" must be an object.', status: 400 };
        }
        variables = b['variables'] as Record<string, unknown>;
      }
      return {
        query:          b['query'],
        variables,
        operationName:  typeof b['operationName'] === 'string' ? b['operationName'] : undefined,
      };
    }

    return { error: `Unsupported Content-Type: ${ct}`, status: 415 };
  }

  return { error: `Method ${method} not allowed. Use GET or POST.`, status: 405 };
}

// ── CORS helpers ─────────────────────────────────────────────────────────────

function resolveOrigin(corsConfig: CorsConfig, origin: string | null): string | null {
  if (!origin) return null;
  const { origins } = corsConfig;
  if (origins === '*') {
    if (corsConfig.credentials) return null; // cannot combine * + credentials
    return '*';
  }
  if (Array.isArray(origins)) {
    return origins.includes(origin) ? origin : null;
  }
  if (typeof origins === 'function') {
    return origins(origin) ? origin : null;
  }
  return null;
}

const GQL_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'Accept',
  'Origin',
].join(', ');

function buildCorsHeaders(
  corsConfig: CorsConfig,
  origin: string | null,
  extra: string[] = [],
): Record<string, string> {
  const allowed = resolveOrigin(corsConfig, origin);
  if (!allowed) return {};

  const allowHeaders = [GQL_ALLOW_HEADERS, ...extra].join(', ');
  const headers: Record<string, string> = {
    'access-control-allow-origin':  allowed,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': allowHeaders,
    'access-control-max-age':       String(corsConfig.maxAge ?? 86400),
  };
  if (corsConfig.credentials) {
    headers['access-control-allow-credentials'] = 'true';
  }
  if (allowed !== '*') {
    headers['vary'] = 'Origin';
  }
  return headers;
}

// ── GraphiQL HTML ────────────────────────────────────────────────────────────

function graphiqlHtml(endpoint: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>◆ Nexus GraphiQL</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css">
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { height: 100dvh; display: flex; flex-direction: column; background: #0a0a0f; }
    #graphiql { flex: 1; overflow: hidden; }
    .graphiql-container { background: #0f0f14 !important; }
  </style>
</head>
<body>
  <div id="graphiql">Loading GraphiQL…</div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  <script>
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    const fetcher = GraphiQL.createFetcher({ url: ${JSON.stringify(endpoint)} });
    root.render(React.createElement(GraphiQL, { fetcher }));
  </script>
</body></html>`;
}

// ── Error response helper ────────────────────────────────────────────────────

function errorResponse(
  errors: Array<{ message: string; extensions?: Record<string, unknown> }>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ errors: errors.map(e => ({ message: e.message, extensions: e.extensions })) }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...extraHeaders,
      },
    },
  );
}

// ── Main factory ─────────────────────────────────────────────────────────────

/**
 * Create a Nexus-compatible GraphQL handler.
 *
 * Mount with:
 * ```ts
 * mounts: [{ path: '/graphql', handler: createGraphQLHandler({ schema, ... }) }]
 * ```
 */
export function createGraphQLHandler<Ctx = MinimalNexusContext>(
  opts: GraphQLHandlerOptions<Ctx>,
): (request: Request, nexusCtx: MinimalNexusContext) => Promise<Response> {
  const {
    schema,
    dev          = false,
    cors:  corsOpts,
    shield: shieldConfig,
    mask:  maskPolicy,
    context: contextFn,
    maxBodyBytes  = 1_048_576, // 1 MB
    rateLimit: rlConfig,
  } = opts;

  // Validate CORS config
  if (corsOpts?.credentials && corsOpts.origins === '*') {
    throw new Error(
      '[Nexus GraphQL] `cors.credentials: true` cannot be used with `cors.origins: "*"`. ' +
      'Browsers will reject this combination. Specify exact allowed origins instead.',
    );
  }

  if (rlConfig) ensurePruneTimer();

  return async function graphqlRequestHandler(
    request: Request,
    nexusCtx: MinimalNexusContext,
  ): Promise<Response> {
    const method = request.method.toUpperCase();
    const origin = request.headers.get('origin');
    const corsHeaders = corsOpts ? buildCorsHeaders(corsOpts, origin, opts.cors?.allowHeaders) : {};

    // ── 1. CORS preflight ────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'content-length': '0',
          ...corsHeaders,
        },
      });
    }

    // ── 2. GraphiQL (dev GET with Accept: text/html) ─────────────────────────
    if (method === 'GET' && dev) {
      const accept = request.headers.get('accept') ?? '';
      const url = new URL(request.url);
      if (accept.includes('text/html') && !url.searchParams.has('query')) {
        return new Response(graphiqlHtml(url.pathname), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders },
        });
      }
    }

    // ── 3. Rate limiting ─────────────────────────────────────────────────────
    if (rlConfig) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? request.headers.get('cf-connecting-ip')
        ?? request.headers.get('x-real-ip')
        ?? 'unknown';

      const rl = checkRateLimit(
        `gql:${ip}`,
        rlConfig.max,
        rlConfig.windowMs ?? 60_000,
      );

      if (!rl.allowed) {
        const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
        return errorResponse(
          [{ message: 'Too many requests. Please retry later.', extensions: { code: 'RATE_LIMITED' } }],
          429,
          {
            ...corsHeaders,
            'retry-after':          String(retryAfter),
            'x-ratelimit-limit':    String(rlConfig.max),
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset':    String(Math.ceil(rl.resetAt / 1000)),
          },
        );
      }
    }

    // ── 4. Parse GraphQL request ─────────────────────────────────────────────
    const parsed = await parseGqlRequest(request, maxBodyBytes);
    if ('error' in parsed) {
      return errorResponse(
        [{ message: parsed.error, extensions: { code: 'BAD_REQUEST' } }],
        parsed.status,
        corsHeaders,
      );
    }

    // ── 5. Parse + validate GraphQL document ─────────────────────────────────
    // Lazy-import graphql to keep it as a true peer dep
    const gql = await import('graphql');

    let document: DocumentNode;
    try {
      document = gql.parse(parsed.query);
    } catch (err) {
      return errorResponse(
        [{ message: (err as Error).message, extensions: { code: 'GRAPHQL_PARSE_FAILED' } }],
        400,
        corsHeaders,
      );
    }

    const validationErrors = gql.validate(schema, document);
    if (validationErrors.length > 0) {
      return errorResponse(
        validationErrors.map(e => ({
          message: e.message,
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        })),
        400,
        corsHeaders,
      );
    }

    // ── 6. Shield: complexity + depth analysis ───────────────────────────────
    if (shieldConfig) {
      const shieldWithDev: ComplexityConfig = {
        ...shieldConfig,
        // Always allow introspection in dev
        allowIntrospection: dev ? true : (shieldConfig.allowIntrospection ?? false),
      };

      const { errors: complexityErrors } = analyseComplexity(document, schema, shieldWithDev);
      if (complexityErrors.length > 0) {
        return errorResponse(complexityErrors, 400, corsHeaders);
      }
    } else if (!dev) {
      // Even without explicit shield config: block introspection in production
      for (const def of document.definitions) {
        if (def.kind === 'OperationDefinition') {
          for (const sel of def.selectionSet.selections) {
            if (sel.kind === 'Field' && sel.name.value === '__schema') {
              return errorResponse(
                [{ message: 'Introspection is disabled.', extensions: { code: 'INTROSPECTION_DISABLED' } }],
                403,
                corsHeaders,
              );
            }
          }
        }
      }
    }

    // ── 7. Build execution context ───────────────────────────────────────────
    let execContext: unknown;
    if (contextFn) {
      try {
        execContext = await contextFn(request, nexusCtx);
      } catch (err) {
        return errorResponse(
          [{ message: 'Failed to build request context.', extensions: { code: 'CONTEXT_ERROR' } }],
          500,
          corsHeaders,
        );
      }
    } else {
      execContext = nexusCtx;
    }

    // ── 8. Execute ───────────────────────────────────────────────────────────
    let rawResult: GraphQLExecutionResult;
    try {
      const execResult = await gql.execute({
        schema,
        document,
        contextValue:   execContext,
        variableValues: parsed.variables,
        operationName:  parsed.operationName,
      });

      const errs = execResult.errors
        ? execResult.errors.map(e => ({ message: e.message, extensions: e.extensions as Record<string, unknown> | undefined, path: e.path, locations: e.locations }))
        : undefined;
      rawResult = {
        data: execResult.data as Record<string, unknown> | null,
        ...(errs ? { errors: errs } : {}),
        ...(execResult.extensions ? { extensions: execResult.extensions as Record<string, unknown> } : {}),
      };
    } catch (err) {
      const msg = dev
        ? `Execution error: ${(err as Error).message}`
        : 'Internal server error';
      return errorResponse(
        [{ message: msg, extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
        500,
        corsHeaders,
      );
    }

    // ── 9. Field masking ─────────────────────────────────────────────────────
    const finalResult = maskPolicy
      ? maskResult(rawResult, maskPolicy as MaskPolicy<unknown>, execContext as unknown)
      : rawResult;

    // Strip stack traces in production
    if (!dev && finalResult.errors) {
      finalResult.errors = (finalResult.errors as Array<Record<string, unknown>>).map(e => ({
        message:    String(e['message'] ?? ''),
        ...(e['extensions'] ? { extensions: e['extensions'] as Record<string, unknown> } : {}),
        ...(e['path']       ? { path:       e['path'] as unknown[] }  : {}),
        ...(e['locations']  ? { locations:  e['locations'] as unknown[] } : {}),
      }));
    }

    const hasErrors  = Array.isArray(finalResult.errors) && finalResult.errors.length > 0;
    const httpStatus = hasErrors && !finalResult.data ? 400 : 200;

    return new Response(JSON.stringify(finalResult), {
      status: httpStatus,
      headers: {
        'content-type':  'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...corsHeaders,
      },
    });
  };
}
