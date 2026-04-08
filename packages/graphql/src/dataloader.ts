/**
 * Nexus DataLoader — N+1 Query Prevention
 *
 * Batches individual loads that occur within the same microtask tick into a
 * single call to your `batchFn`. This eliminates the N+1 problem in GraphQL
 * resolvers without requiring a database ORM.
 *
 * Comparison to the popular `dataloader` npm package:
 *  - Same API surface: `loader.load(key)` → `Promise<Value>`
 *  - Same batching model: deduplication + microtask coalescing
 *  - No external dependency — uses only built-in `queueMicrotask`
 *  - Typed with generics
 *  - `loadMany(keys)` helper for bulk lookups
 *
 * Usage
 * ─────
 *  // Create per-request (critical: not a singleton!) inside the GraphQL context factory.
 *
 *  const userLoader = createBatchLoader<string, User>(async (ids) => {
 *    const rows = await db.users.findMany({ where: { id: { in: ids } } });
 *    // IMPORTANT: return values in the SAME ORDER as `ids`.
 *    return ids.map(id => rows.find(r => r.id === id) ?? new Error(`User ${id} not found`));
 *  });
 *
 *  // In resolver:
 *  const user = await ctx.loaders.user.load(userId);
 *
 * Key ordering contract
 * ─────────────────────
 *  Your `batchFn` MUST return an array of the same length as `keys`, in the
 *  same order. Return an `Error` instance for individual failures without
 *  rejecting the whole batch.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Batch function: receives deduplicated keys, returns values in the same order.
 * Individual errors: return an `Error` in place of the value for that position.
 */
export type BatchFn<K, V> = (keys: readonly K[]) => Promise<ReadonlyArray<V | Error>>;

/** Cache key serialiser — defaults to `JSON.stringify`. Override for non-primitive keys. */
export type CacheKeyFn<K> = (key: K) => string;

export interface BatchLoaderOptions<K> {
  /** Custom key serialiser for non-primitive key types. Default: JSON.stringify. */
  cacheKeyFn?: CacheKeyFn<K>;
  /** Disable in-flight deduplication (each load always queues a new item). Default: false. */
  disableCache?: boolean;
  /**
   * Maximum batch size. When exceeded, flush immediately and start a new batch.
   * Default: Infinity (unbounded).
   */
  maxBatchSize?: number;
}

// ── Implementation ───────────────────────────────────────────────────────────

interface QueueItem<K, V> {
  key:     K;
  resolve: (value: V) => void;
  reject:  (reason: Error) => void;
}

export class BatchLoader<K, V> {
  private readonly batchFn:      BatchFn<K, V>;
  private readonly cacheKeyFn:   CacheKeyFn<K>;
  private readonly disableCache: boolean;
  private readonly maxBatchSize: number;

  /** In-flight dedup cache: cacheKey → pending promise */
  private readonly cache = new Map<string, Promise<V>>();

  /** Current batch queue */
  private queue: QueueItem<K, V>[] = [];
  private flushScheduled = false;

  constructor(batchFn: BatchFn<K, V>, options: BatchLoaderOptions<K> = {}) {
    this.batchFn      = batchFn;
    this.cacheKeyFn   = options.cacheKeyFn  ?? ((k) => JSON.stringify(k));
    this.disableCache = options.disableCache ?? false;
    this.maxBatchSize = options.maxBatchSize ?? Infinity;
  }

  /** Load a single value by key. Deduplicates concurrent loads for the same key. */
  load(key: K): Promise<V> {
    const cacheKey = this.cacheKeyFn(key);

    if (!this.disableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      this.scheduleFlush();
    });

    if (!this.disableCache) {
      this.cache.set(cacheKey, promise);
    }

    return promise;
  }

  /** Load multiple keys — convenience wrapper. */
  loadMany(keys: readonly K[]): Promise<Array<V | Error>> {
    return Promise.all(
      keys.map(k =>
        this.load(k).catch((err: unknown) =>
          err instanceof Error ? err : new Error(String(err)),
        ),
      ),
    );
  }

  /** Remove a specific key from the deduplication cache (force a fresh load). */
  clear(key: K): this {
    this.cache.delete(this.cacheKeyFn(key));
    return this;
  }

  /** Wipe the entire dedup cache. */
  clearAll(): this {
    this.cache.clear();
    return this;
  }

  /** Prime the cache with a known value (avoids a future batch call). */
  prime(key: K, value: V): this {
    const cacheKey = this.cacheKeyFn(key);
    if (!this.cache.has(cacheKey)) {
      this.cache.set(cacheKey, Promise.resolve(value));
    }
    return this;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.queue.length >= this.maxBatchSize) {
      // Flush immediately when the batch limit is reached
      void this.flush();
      return;
    }
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => void this.flush());
    }
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    if (this.queue.length === 0) return;

    // Drain the current queue
    const batch = this.queue.splice(0);

    // Deduplicate keys (preserving order for the result map)
    const seen    = new Map<string, K>();
    const keyList: K[] = [];
    for (const item of batch) {
      const ck = this.cacheKeyFn(item.key);
      if (!seen.has(ck)) {
        seen.set(ck, item.key);
        keyList.push(item.key);
      }
    }

    let values: ReadonlyArray<V | Error>;
    try {
      values = await this.batchFn(keyList);
    } catch (err) {
      // Entire batch failed — reject all items
      const error = err instanceof Error ? err : new Error(String(err));
      for (const item of batch) {
        item.reject(error);
        this.cache.delete(this.cacheKeyFn(item.key));
      }
      return;
    }

    // Build key → value map
    const resultMap = new Map<string, V | Error>();
    keyList.forEach((k, i) => {
      resultMap.set(this.cacheKeyFn(k), values[i] ?? new Error(`Missing value for key at index ${i}`));
    });

    // Resolve / reject each original queue item
    for (const item of batch) {
      const result = resultMap.get(this.cacheKeyFn(item.key));
      if (result === undefined) {
        const err = new Error(`[Nexus DataLoader] batchFn returned no value for key: ${this.cacheKeyFn(item.key)}`);
        item.reject(err);
        this.cache.delete(this.cacheKeyFn(item.key));
      } else if (result instanceof Error) {
        item.reject(result);
        this.cache.delete(this.cacheKeyFn(item.key));
      } else {
        item.resolve(result);
      }
    }
  }
}

/**
 * Convenience factory — same as `new BatchLoader(batchFn, opts)`.
 *
 * @example
 *   const userLoader = createBatchLoader(async (ids) => db.users.findMany({ where: { id: { in: ids } } }));
 */
export function createBatchLoader<K, V>(
  batchFn: BatchFn<K, V>,
  options?: BatchLoaderOptions<K>,
): BatchLoader<K, V> {
  return new BatchLoader(batchFn, options);
}

/**
 * Create a per-request loader registry.
 * Pass the factory as your GraphQL context `loaders` field.
 *
 * @example
 *   const loaders = createLoaderRegistry({
 *     user:    createBatchLoader(ids => db.users.findMany(...)),
 *     product: createBatchLoader(ids => db.products.findMany(...)),
 *   });
 *
 *   // In resolver: ctx.loaders.user.load(userId)
 */
export function createLoaderRegistry<
  T extends Record<string, BatchLoader<unknown, unknown>>,
>(loaders: T): T {
  return loaders;
}
