/**
 * Nexus Cache & Revalidation System.
 *
 * Server-side: Tags routes as cacheable, invalidates on demand.
 * Client-side: Coordinates revalidation after Server Actions.
 *
 * Usage:
 *
 * In a server block:
 *   const posts = await cache(() => db.post.findMany(), {
 *     tags: ['posts'],
 *     ttl: 60, // seconds
 *   });
 *
 * In a Server Action:
 *   async function createPost(formData) {
 *     "use server";
 *     await db.post.create({ ... });
 *     await revalidate(['posts']); // Purges cache tag 'posts'
 *   }
 *
 * After revalidation, any route that fetched with tag 'posts' gets
 * re-rendered on the next request (stale-while-revalidate pattern).
 */

export interface CacheOptions {
  /** Tags for targeted invalidation */
  tags?: string[];
  /** Time-to-live in seconds. 0 = no cache. Infinity = permanent. */
  ttl?: number;
  /** Stale-while-revalidate window in seconds */
  swr?: number;
  /** Key override (default: auto-generated from function source) */
  key?: string;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  swrExpiresAt: number;
  tags: Set<string>;
}

// ── In-memory cache (replace with Redis adapter in production) ─────────────
const memCache = new Map<string, CacheEntry<unknown>>();
const tagIndex = new Map<string, Set<string>>();

/**
 * Wraps an async data-fetching function with caching.
 * Implements stale-while-revalidate for zero-latency serving.
 */
export async function cache<T>(
  fn: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<T> {
  const key = opts.key ?? generateKey(fn);
  const ttl = opts.ttl ?? 60;
  const swr = opts.swr ?? ttl * 2;
  const tags = opts.tags ?? [];
  const now = Date.now();

  const existing = memCache.get(key) as CacheEntry<T> | undefined;

  if (existing) {
    // Fresh hit
    if (now < existing.expiresAt) {
      return existing.value;
    }

    // Stale hit — serve stale, trigger background revalidation
    if (now < existing.swrExpiresAt) {
      revalidateInBackground(key, fn, ttl, swr, tags);
      return existing.value;
    }
  }

  // Cache miss or expired — fetch fresh
  const value = await fn();
  setCache(key, value, ttl, swr, tags);
  return value;
}

/**
 * Invalidates all cache entries with the given tags.
 * Call this after Server Actions that mutate data.
 */
export async function revalidate(tags: string[]): Promise<void> {
  for (const tag of tags) {
    const keys = tagIndex.get(tag);
    if (!keys) continue;
    for (const key of keys) {
      memCache.delete(key);
    }
    tagIndex.delete(tag);
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    console.log(`[Nexus Cache] Invalidated tags: ${tags.join(', ')}`);
  }
}

/**
 * Invalidates a specific cache key (path-based).
 */
export async function revalidatePath(path: string): Promise<void> {
  const key = `path:${path}`;
  memCache.delete(key);
  console.log(`[Nexus Cache] Invalidated path: ${path}`);
}

/**
 * Returns cache statistics for diagnostics.
 */
export function cacheStats(): {
  size: number;
  tags: number;
  entries: Array<{ key: string; expiresIn: number; tags: string[] }>;
} {
  const now = Date.now();
  return {
    size: memCache.size,
    tags: tagIndex.size,
    entries: [...memCache.entries()].map(([key, entry]) => ({
      key,
      expiresIn: Math.max(0, Math.floor((entry.expiresAt - now) / 1000)),
      tags: [...entry.tags],
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function setCache<T>(
  key: string,
  value: T,
  ttl: number,
  swr: number,
  tags: string[],
): void {
  const now = Date.now();
  const entry: CacheEntry<T> = {
    value,
    expiresAt: now + ttl * 1000,
    swrExpiresAt: now + swr * 1000,
    tags: new Set(tags),
  };
  memCache.set(key, entry as CacheEntry<unknown>);

  // Update tag index
  for (const tag of tags) {
    if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
    tagIndex.get(tag)!.add(key);
  }
}

function revalidateInBackground<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number,
  swr: number,
  tags: string[],
): void {
  fn()
    .then((value) => setCache(key, value, ttl, swr, tags))
    .catch((err) => console.error(`[Nexus Cache] Background revalidation failed for "${key}":`, err));
}

function generateKey(fn: () => unknown): string {
  // Use function source as key (stable across hot reloads in dev)
  const src = fn.toString();
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fn:${(h >>> 0).toString(16)}`;
}

// ── Cache adapters (for production — plug in Redis, Cloudflare KV, etc.) ────

export interface CacheAdapter {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>;
  del: (keys: string[]) => Promise<void>;
  tags: {
    add: (tag: string, key: string) => Promise<void>;
    keys: (tag: string) => Promise<string[]>;
    clear: (tag: string) => Promise<void>;
  };
}

let _adapter: CacheAdapter | null = null;

export function setCacheAdapter(adapter: CacheAdapter): void {
  _adapter = adapter;
}
