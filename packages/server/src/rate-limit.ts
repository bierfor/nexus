/**
 * Nexus Per-Action Rate Limiter — Sliding Window Algorithm.
 *
 * Unlike middleware-level rate limiting (which throttles the entire API),
 * Nexus allows granular limits per Server Action. You define the policy
 * alongside the action handler — not in a separate config file.
 *
 * Usage:
 *
 * ```ts
 * export const capture = createAction({
 *   rateLimit: { window: '1m', max: 3, keyFn: (req) => req.userId },
 *   handler: async (data) => { ... }
 * });
 * ```
 *
 * Algorithm: Sliding window log — stores timestamps of each request.
 * Timestamps older than `window` are evicted before checking the limit.
 * This is more accurate than the fixed window approach (no edge-of-window bursts).
 *
 * Memory: O(max * unique_keys). For typical SaaS usage with 10K users and
 * max=10, this is ~100K timestamp entries — well within Node.js limits.
 * For high-scale, replace the Map with Redis ZSET.
 */

export interface RateLimitConfig {
  /**
   * Time window for the limit.
   * Formats: '30s', '1m', '5m', '15m', '1h', '6h', '24h'
   */
  window: string;
  /** Maximum requests allowed within the window. */
  max: number;
  /**
   * Function to derive the rate limit key from the request.
   * Default: IP address extracted from common proxy headers.
   * Override for user-specific limits: (req) => req.headers.get('x-user-id') ?? 'anon'
   */
  keyFn?: (request: Request) => string;
}

export interface RateLimitResult {
  allowed:   boolean;
  remaining: number;    // requests remaining in current window
  limit:     number;    // total limit
  resetAt:   number;    // epoch ms when the window resets
  retryAfter?: number;  // seconds to wait before retrying (only when blocked)
}

export interface RateLimiter {
  check(request: Request): RateLimitResult;
  /** Reset the limit for a specific key (useful in tests or after user verification). */
  reset(key: string): void;
  /** Returns a headers object to add to the response for RFC 6585 compliance. */
  headers(result: RateLimitResult): Record<string, string>;
}

// ── Window parser ─────────────────────────────────────────────────────────────

const WINDOW_RE = /^(\d+)(s|m|h|d)$/;

export function parseWindow(window: string): number {
  const m = WINDOW_RE.exec(window);
  if (!m) throw new Error(`[Nexus Rate Limit] Invalid window format: "${window}". Use '30s', '1m', '5m', '1h', '24h'.`);
  const n = parseInt(m[1] ?? '1', 10);
  switch (m[2]) {
    case 's': return n * 1_000;
    case 'm': return n * 60 * 1_000;
    case 'h': return n * 60 * 60 * 1_000;
    case 'd': return n * 24 * 60 * 60 * 1_000;
    default:  return 60_000;
  }
}

// ── IP extraction ─────────────────────────────────────────────────────────────

function extractIP(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??  // Cloudflare
    request.headers.get('x-client-ip') ??
    'unknown'
  );
}

// ── Shared GC timer ───────────────────────────────────────────────────────────
// Instead of one setInterval per limiter instance (which can accumulate when
// many actions each call createRateLimiter), we register every limiter's hits
// map into a module-level set and run a single shared GC pass.

type LimiterEntry = { hits: Map<string, number[]>; windowMs: number };
const _allLimiters = new Set<LimiterEntry>();

let _gcTimer: ReturnType<typeof setInterval> | undefined;
const GC_INTERVAL_MS = 60_000; // 1 min global sweep

function ensureGcTimer(): void {
  if (_gcTimer !== undefined) return;
  _gcTimer = setInterval(() => {
    const now = Date.now();
    for (const entry of _allLimiters) {
      for (const [key, timestamps] of entry.hits) {
        const recent = timestamps.filter((t) => t > now - entry.windowMs);
        if (recent.length === 0) {
          entry.hits.delete(key);
        } else {
          entry.hits.set(key, recent);
        }
      }
    }
  }, GC_INTERVAL_MS);
  _gcTimer.unref?.();
}

// ── Limiter factory ───────────────────────────────────────────────────────────

/**
 * Creates a reusable sliding-window rate limiter.
 *
 * @example
 * const captureLimit = createRateLimiter({ window: '1m', max: 3 });
 * // In your action handler:
 * const result = captureLimit.check(request);
 * if (!result.allowed) throw new RateLimitError(result);
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const windowMs = parseWindow(config.window);
  const keyFn    = config.keyFn ?? extractIP;
  // key → sorted array of hit timestamps
  const hits     = new Map<string, number[]>();

  // Register with the shared GC and start the timer if needed
  const entry: LimiterEntry = { hits, windowMs };
  _allLimiters.add(entry);
  ensureGcTimer();

  function check(request: Request): RateLimitResult {
    const key    = keyFn(request);
    const now    = Date.now();
    const cutoff = now - windowMs;

    // Evict expired timestamps for this key inline (lazy eviction)
    const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);

    const resetAt   = timestamps.length > 0 ? (timestamps[0]! + windowMs) : (now + windowMs);
    const remaining = Math.max(0, config.max - timestamps.length);
    const allowed   = timestamps.length < config.max;

    if (allowed) {
      timestamps.push(now);
      hits.set(key, timestamps);
    }

    const result: RateLimitResult = {
      allowed,
      remaining: allowed ? remaining - 1 : 0,
      limit:     config.max,
      resetAt,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((resetAt - now) / 1_000);
    }

    return result;
  }

  function reset(key: string): void {
    hits.delete(key);
  }

  function headers(result: RateLimitResult): Record<string, string> {
    const h: Record<string, string> = {
      'x-ratelimit-limit':     String(result.limit),
      'x-ratelimit-remaining': String(result.remaining),
      'x-ratelimit-reset':     String(Math.ceil(result.resetAt / 1_000)), // Unix epoch seconds
    };
    if (!result.allowed && result.retryAfter !== undefined) {
      h['retry-after'] = String(result.retryAfter);
    }
    return h;
  }

  return { check, reset, headers };
}

// ── Error class ───────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  readonly result: RateLimitResult;

  constructor(result: RateLimitResult) {
    super(
      `Rate limit exceeded. ` +
      `Retry in ${result.retryAfter ?? '?'}s. ` +
      `Limit: ${result.limit} requests per window.`
    );
    this.name     = 'RateLimitError';
    this.result   = result;
  }
}

// ── Global registry ───────────────────────────────────────────────────────────
// Named limiters can be looked up by the server to attach headers to responses.

const registry = new Map<string, RateLimiter>();

export function registerLimiter(name: string, limiter: RateLimiter): void {
  registry.set(name, limiter);
}

export function getLimiter(name: string): RateLimiter | undefined {
  return registry.get(name);
}
