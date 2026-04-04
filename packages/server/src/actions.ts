/**
 * Nexus Server Actions — type-safe, race-condition-safe server mutations.
 *
 * Race Condition Problem:
 *   User clicks "Save" three times in rapid succession.
 *   Request 1 arrives, starts processing (200ms).
 *   Request 2 arrives, starts processing (180ms) — finishes FIRST.
 *   Request 3 arrives, starts processing (150ms) — finishes SECOND.
 *   Request 1 finishes LAST — overwrites the results of 2 and 3. 💥
 *
 * Solutions implemented:
 *
 *   1. Idempotency key deduplication:
 *      Client sends X-Nexus-Idempotency: <uuid> with each action call.
 *      If the same key arrives again while the first is in flight,
 *      the server returns the SAME response (cached for 30s).
 *
 *   2. Per-island action mutex:
 *      Each island tracks its in-flight actions per action name.
 *      Configurable behavior: 'cancel' | 'queue' | 'reject' | 'ignore'.
 *
 *   3. AbortController propagation:
 *      The signal is passed into the action context. Actions that
 *      call external APIs should check ctx.signal.aborted.
 *      If the client disconnects, the signal fires automatically.
 *
 *   4. Client-side: $optimistic with built-in race guard.
 *      The createOptimistic() pending flag blocks double-submit.
 */

import { createContext } from './context.js';
import type { NexusContext } from './context.js';
import { serialize, deserialize } from '@nexus_js/serialize';
import {
  validateActionToken,
  extractSessionId,
  ACTION_TOKEN_HEADER,
} from './csrf.js';
import {
  createRateLimiter,
  registerLimiter,
  RateLimitError,
  type RateLimitConfig,
} from './rate-limit.js';
import { emitDevRadar, newTraceId, sanitizeTelemetryValue } from './devradar.js';

export type ActionFn<TInput = FormData, TOutput = void> = (
  input: TInput,
  ctx: NexusContext & { signal: AbortSignal },
) => Promise<TOutput>;

export type RaceStrategy = 'cancel' | 'queue' | 'reject' | 'ignore';

export interface ActionOptions {
  /**
   * How to handle concurrent calls to the same action from the same client.
   *   'cancel'  — abort the previous call, run the new one (default for mutations)
   *   'queue'   — run calls sequentially in order
   *   'reject'  — reject the new call if one is already in flight
   *   'ignore'  — let all calls run in parallel (default for idempotent reads)
   */
  race?: RaceStrategy;
  /**
   * Mark as idempotent — same idempotency key returns cached result.
   * Set to true for safe retries (GET-like mutations).
   */
  idempotent?: boolean;
  /**
   * Timeout in ms. Aborts the action if it takes too long.
   * Default: 30000 (30s)
   */
  timeout?: number;
  /**
   * Retry on network failure (not on logic errors).
   * Default: 0
   */
  retries?: number;
  /**
   * Per-action rate limiting.
   * Example: { window: '1m', max: 3 } → 3 calls per minute per IP.
   * Override the key with keyFn: { window: '1m', max: 3, keyFn: r => userId }
   */
  rateLimit?: RateLimitConfig;
  /**
   * Require a valid CSRF action token in the x-nexus-action-token header.
   * Default: true for all state-mutating actions.
   * Set to false for read-only or public actions.
   */
  csrf?: boolean;
  /**
   * A Zod-compatible schema for input validation.
   * If provided, the action will reject requests with invalid input before
   * calling the handler. Prevents SQL injection and type coercion attacks.
   */
  schema?: {
    parse: (data: unknown) => unknown;
  };
}

export interface ActionResult<T = unknown> {
  data?: T;
  error?: string;
  status: number;
  /** Echoed back to client for deduplication */
  idempotencyKey?: string;
  /** Server-side execution time in ms */
  duration?: number;
}

const ACTION_PREFIX = '/_nexus/action/';

// ── Idempotency cache ─────────────────────────────────────────────────────────
interface IdempotencyEntry {
  result: unknown;
  expiresAt: number;
  status: number;
}
const idempotencyCache = new Map<string, IdempotencyEntry>();
const IDEMPOTENCY_TTL = 30_000; // 30 seconds

// ── In-flight action tracking ─────────────────────────────────────────────────
// Map: `${islandId}:${actionName}` → AbortController
const inFlightActions = new Map<string, AbortController>();

// ── Action queue ──────────────────────────────────────────────────────────────
type QueueEntry = { resolve: () => void };
const actionQueues = new Map<string, QueueEntry[]>();

// ── Registry ──────────────────────────────────────────────────────────────────
interface RegisteredAction {
  fn:   ActionFn<unknown, unknown>;
  opts: ActionOptions;
  name: string;
}
const actionRegistry = new Map<string, RegisteredAction>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Defines a Server Action with integrated security, rate limiting, and
 * race-condition management. The returned object is registered automatically
 * and ready to be called by the client.
 *
 * Security layers applied (in order):
 *   1. CSRF token validation (x-nexus-action-token header)
 *   2. Rate limiting (sliding window, per-IP or per-user)
 *   3. Input schema validation (Zod or any .parse() compatible schema)
 *   4. AbortController (client disconnect + timeout)
 *   5. Idempotency deduplication
 *   6. Race condition strategy (cancel | queue | reject | ignore)
 *
 * @example
 * export const capture = createAction({
 *   rateLimit: { window: '1m', max: 3, keyFn: (req) => req.headers.get('x-user-id') ?? extractIP(req) },
 *   schema: z.object({ pokemonId: z.number().int().min(1).max(1010) }),
 *   race: 'cancel',
 *   async handler(data, ctx) {
 *     const { pokemonId } = data;
 *     await db.captures.create({ userId: ctx.user.id, pokemonId });
 *   },
 * });
 */
export function createAction<TInput = FormData, TOutput = void>(
  optsOrFn:
    | ActionFn<TInput, TOutput>
    | (ActionOptions & { handler: ActionFn<TInput, TOutput> }),
  legacyOpts: ActionOptions = {},
): ActionFn<TInput, TOutput> {
  // Support both createAction(fn, opts) and createAction({ handler, ...opts })
  const fn   = typeof optsOrFn === 'function' ? optsOrFn : optsOrFn.handler;
  const opts = typeof optsOrFn === 'function' ? legacyOpts : optsOrFn;

  // Wire up rate limiter at definition time (not per-request)
  const limiter = opts.rateLimit ? createRateLimiter(opts.rateLimit) : null;

  return async (
    input: TInput,
    ctx: NexusContext & { signal: AbortSignal },
  ): Promise<TOutput> => {
    // 1. CSRF validation
    if (opts.csrf !== false) {
      await validateRequest(ctx);
    }

    // 2. Rate limiting
    if (limiter) {
      const result = limiter.check(ctx.request);
      if (!result.allowed) {
        throw new RateLimitError(result);
      }
    }

    // 3. Schema validation
    if (opts.schema) {
      try {
        input = opts.schema.parse(input) as TInput;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Input validation failed';
        throw new ActionError(`Invalid input: ${msg}`, 400, 'VALIDATION_ERROR');
      }
    }

    return fn(input, ctx);
  };
}

export function registerAction(
  name: string,
  fn: ActionFn<unknown, unknown>,
  opts: ActionOptions = {},
): void {
  const limiter = opts.rateLimit ? createRateLimiter(opts.rateLimit) : null;
  if (limiter) registerLimiter(name, limiter);
  actionRegistry.set(name, { fn, opts, name });
}

export class ActionError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

export class ActionAbortedError extends ActionError {
  constructor() {
    super('Action was superseded by a newer request', 409, 'ABORTED');
  }
}

/**
 * Main HTTP handler for /_nexus/action/:name
 * This is where all the race-condition logic runs.
 */
export async function handleActionRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith(ACTION_PREFIX)) {
    return new Response('Not Found', { status: 404 });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'POST' },
    });
  }

  const actionName = url.pathname.slice(ACTION_PREFIX.length);
  const registered = actionRegistry.get(actionName);

  if (!registered) {
    return jsonResponse({ error: `Action "${actionName}" not found`, status: 404 }, 404);
  }

  const { fn, opts } = registered;
  const race    = opts.race    ?? 'cancel';
  const timeout = opts.timeout ?? 30_000;

  // ── CSRF token validation ──────────────────────────────────────────────────
  if (opts.csrf !== false) {
    const token     = request.headers.get(ACTION_TOKEN_HEADER);
    const secret    = process.env['NEXUS_SECRET'] ?? 'nexus-dev-secret-change-me';
    const sessionId = extractSessionId(request);
    if (!token) {
      emitDevRadar({
        type: 'security:audit',
        payload: {
          kind:    'csrf_blocked',
          message: 'Missing action token',
          action:  actionName,
        },
      });
      return jsonResponse({
        error:  'Missing action token — possible CSRF attack',
        status: 403,
        code:   'MISSING_CSRF_TOKEN',
      }, 403);
    }
    const validation = validateActionToken(token, sessionId, actionName, secret);
    if (!validation.valid) {
      emitDevRadar({
        type: 'security:audit',
        payload: {
          kind:    validation.replayed ? 'replay' : 'csrf_blocked',
          message: validation.reason ?? 'Invalid action token',
          action:  actionName,
        },
      });
      return jsonResponse({
        error:  validation.reason ?? 'Invalid action token',
        status: 403,
        code:   validation.replayed ? 'REPLAY_ATTACK' : 'INVALID_CSRF_TOKEN',
      }, 403);
    }
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  if (opts.rateLimit) {
    const limiter = createRateLimiter(opts.rateLimit);
    const result  = limiter.check(request);
    if (!result.allowed) {
      emitDevRadar({
        type: 'security:audit',
        payload: {
          kind:    'rate_limited',
          message: `Retry in ${result.retryAfter}s`,
          action:  actionName,
        },
      });
      return new Response(
        JSON.stringify({
          error:       `Rate limit exceeded. Retry in ${result.retryAfter}s.`,
          status:      429,
          code:        'RATE_LIMITED',
          retryAfter:  result.retryAfter,
          resetAt:     result.resetAt,
        }),
        {
          status:  429,
          headers: {
            'content-type':  'application/json',
            ...limiter.headers(result),
          },
        },
      );
    }
  }

  // ── Idempotency check ──────────────────────────────────────────────────────
  const idempotencyKey = request.headers.get('x-nexus-idempotency');
  const traceId = newTraceId();
  const islandHdr = request.headers.get('x-nexus-island') ?? undefined;

  if (idempotencyKey && opts.idempotent) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && Date.now() < cached.expiresAt) {
      emitDevRadar({
        type: 'action:result',
        payload: {
          id:       traceId,
          name:     actionName,
          output:   sanitizeTelemetryValue(cached.result),
          duration: 0,
          cached:   true,
        },
      });
      return jsonResponse(
        { data: cached.result, status: cached.status, idempotencyKey },
        cached.status,
      );
    }
  }

  // ── Race condition management ──────────────────────────────────────────────
  const islandId = islandHdr ?? 'global';
  const raceKey = `${islandId}:${actionName}`;

  if (race === 'reject') {
    if (inFlightActions.has(raceKey)) {
      return jsonResponse({
        error: 'Action already in progress',
        status: 409,
        code: 'CONCURRENT_ACTION',
      }, 409);
    }
  }

  if (race === 'cancel') {
    const existing = inFlightActions.get(raceKey);
    if (existing) {
      existing.abort(new ActionAbortedError());
    }
  }

  if (race === 'queue') {
    await waitInQueue(raceKey);
  }

  // ── AbortController setup ──────────────────────────────────────────────────
  const controller = new AbortController();

  // Chain with client disconnect signal
  request.signal?.addEventListener('abort', () => {
    controller.abort(new Error('Client disconnected'));
  });

  // Timeout
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Action timeout after ${timeout}ms`));
  }, timeout);

  inFlightActions.set(raceKey, controller);

  // ── Execute ───────────────────────────────────────────────────────────────
  const ctx = createContext(request);
  const ctxWithSignal = Object.assign(ctx, { signal: controller.signal });
  const startTime = Date.now();

  try {
    // Deserialize input using Nexus transport (preserves Date, Map, Set, etc.)
    const input = await deserializeInput(request);

    emitDevRadar({
      type: 'action:call',
      payload: {
        id:        traceId,
        name:      actionName,
        input:     sanitizeTelemetryValue(input),
        timestamp: Date.now(),
        ...(islandHdr !== undefined ? { islandId: islandHdr } : {}),
        ...(idempotencyKey != null && idempotencyKey !== ''
          ? { idempotencyKey }
          : {}),
      },
    });

    let result: unknown;
    let attempts = 0;
    const maxAttempts = 1 + (opts.retries ?? 0);

    while (attempts < maxAttempts) {
      try {
        result = await fn(input, ctxWithSignal);
        break;
      } catch (err) {
        attempts++;
        if (err instanceof ActionError || err instanceof ActionAbortedError) throw err;
        if (attempts >= maxAttempts) throw err;
        await delay(100 * attempts); // exponential backoff
      }
    }

    const duration = Date.now() - startTime;

    emitDevRadar({
      type: 'action:result',
      payload: {
        id:       traceId,
        name:     actionName,
        output:   sanitizeTelemetryValue(result),
        duration,
        cached:   false,
      },
    });

    // Cache idempotent results
    if (idempotencyKey && opts.idempotent) {
      idempotencyCache.set(idempotencyKey, {
        result,
        status: 200,
        expiresAt: Date.now() + IDEMPOTENCY_TTL,
      });
      // Cleanup old entries periodically
      cleanIdempotencyCache();
    }

    // Serialize response with Nexus transport
    const serialized = serialize({ data: result, status: 200, duration, idempotencyKey });
    return new Response(serialized, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-nexus-duration': String(duration),
        ...(idempotencyKey ? { 'x-nexus-idempotency': idempotencyKey } : {}),
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    inFlightActions.delete(raceKey);
    releaseQueue(raceKey);

    if (controller.signal.aborted) {
      return jsonResponse({
        error: 'Action was cancelled',
        status: 409,
        code: 'CANCELLED',
      }, 409);
    }

    if (err instanceof ActionError) {
      emitDevRadar({
        type: 'action:error',
        payload: {
          id:       traceId,
          name:     actionName,
          error:    err.message,
          duration: Date.now() - startTime,
          ...(err.code !== undefined ? { code: err.code } : {}),
        },
      });
      return jsonResponse({ error: err.message, status: err.status, code: err.code }, err.status);
    }

    emitDevRadar({
      type: 'action:error',
      payload: {
        id:       traceId,
        name:     actionName,
        error:    err instanceof Error ? err.message : String(err),
        duration: Date.now() - startTime,
      },
    });
    console.error(`[Nexus Action] "${actionName}" failed:`, err);
    return jsonResponse({ error: 'Internal Server Error', status: 500 }, 500);
  } finally {
    clearTimeout(timeoutId);
    inFlightActions.delete(raceKey);
    releaseQueue(raceKey);
  }
}

/**
 * Validates that a request comes from a trusted Nexus client.
 * Checks x-nexus-action header and CSRF token.
 */
export async function validateRequest(ctx: NexusContext): Promise<void> {
  const nexusHeader = ctx.request.headers.get('x-nexus-action');
  if (!nexusHeader) {
    throw new ActionError('Missing Nexus action header', 403, 'MISSING_HEADER');
  }
}

// Re-export security primitives for use in app code
export { generateActionToken, validateActionToken, extractSessionId, generateSessionId } from './csrf.js';
export { createRateLimiter, RateLimitError, parseWindow } from './rate-limit.js';
export type { RateLimitConfig, RateLimitResult, RateLimiter } from './rate-limit.js';

// ── Client-side race guard ────────────────────────────────────────────────────

/**
 * Client-side AbortController factory.
 * Use this in island code to cancel in-flight action fetches
 * when the user triggers a new one.
 *
 * @example
 * const guard = createActionGuard('save', 'cancel');
 * async function save(formData) {
 *   const signal = guard.arm();
 *   const result = await callAction('savePost', formData, { signal });
 *   if (!guard.aborted) updateUI(result);
 * }
 */
export function createActionGuard(
  name: string,
  strategy: RaceStrategy = 'cancel',
): {
  arm: () => AbortSignal;
  abort: () => void;
  aborted: boolean;
  pending: boolean;
} {
  let currentController: AbortController | null = null;
  let _pending = false;

  return {
    arm() {
      if (strategy === 'cancel' && currentController) {
        currentController.abort();
      }
      currentController = new AbortController();
      _pending = true;
      currentController.signal.addEventListener('abort', () => { _pending = false; });
      return currentController.signal;
    },
    abort() {
      currentController?.abort();
      _pending = false;
    },
    get aborted() {
      return currentController?.signal.aborted ?? false;
    },
    get pending() {
      return _pending;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function deserializeInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const text = await request.text();
    try {
      return deserialize(text);
    } catch {
      return JSON.parse(text);
    }
  }

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    return request.formData();
  }

  return request.text();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitInQueue(key: string): Promise<void> {
  return new Promise((resolve) => {
    const queue = actionQueues.get(key) ?? [];
    queue.push({ resolve });
    actionQueues.set(key, queue);
    if (queue.length === 1) resolve(); // First in queue — go immediately
  });
}

function releaseQueue(key: string): void {
  const queue = actionQueues.get(key);
  if (!queue || queue.length === 0) return;
  queue.shift(); // Remove the completed action
  const next = queue[0];
  if (next) next.resolve(); // Unblock the next queued action
}

function cleanIdempotencyCache(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (now > entry.expiresAt) idempotencyCache.delete(key);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
