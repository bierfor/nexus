/**
 * @nexus/db — BYOD (Bring Your Own DB) thin provider adapter.
 *
 * PHILOSOPHY:
 *   Nexus does NOT ship an ORM. Prisma and Drizzle are production-grade tools
 *   maintained by dedicated teams. Nexus's job is to be the *glue layer* that:
 *
 *     1. Makes any DB client Edge-compatible (connection pooling awareness)
 *     2. Wires cache() tags to DB table names automatically
 *     3. Exposes the client to Server Actions via ctx.db (fully typed)
 *     4. Integrates invalidation with revalidate() on mutation
 *
 * SUPPORTED CLIENTS (via official adapters):
 *   - Prisma       →  @nexus/db/adapters/prisma
 *   - Drizzle ORM  →  @nexus/db/adapters/drizzle
 *   - libSQL/Turso →  @nexus/db/adapters/libsql
 *   - Any custom   →  defineDB<TClient>() directly
 *
 * USAGE:
 *   // nexus.config.ts
 *   import { defineDB } from '@nexus/db';
 *   import { PrismaClient } from '@prisma/client';
 *
 *   export default defineNexus({
 *     db: defineDB(new PrismaClient(), {
 *       tags: (table) => [table],
 *     }),
 *   });
 *
 *   // In a Server Action or frontmatter
 *   export async function createPost(input: FormData, ctx: NexusContext) {
 *     "use server";
 *     const post = await ctx.db.post.create({ data: { ... } });
 *     await revalidate({ tags: ['post'] });
 *     return post;
 *   }
 */

import { cache, revalidate } from '@nexus/runtime';
import { serialize } from '@nexus/serialize';

// ── Core types ─────────────────────────────────────────────────────────────────

export interface DBOptions<TClient> {
  /**
   * Derive cache tags from a table/model name.
   * Called automatically when you use db.query() with tag tracking enabled.
   * Default: (table) => [table]
   */
  tags?: (table: string) => string[];

  /**
   * TTL for DB query results in seconds.
   * Passed to cache() automatically.
   * Default: 0 (no caching)
   */
  defaultTtl?: number;

  /**
   * Run before every query — use for logging, metrics, Row-Level Security, etc.
   */
  beforeQuery?: (ctx: QueryContext<TClient>) => Promise<void> | void;

  /**
   * Run after every query — use for cache warming, audit logs, etc.
   */
  afterQuery?: (ctx: QueryContext<TClient>, result: unknown) => Promise<void> | void;

  /**
   * Edge runtime hint — when true, Nexus skips connection pool setup.
   * Set to true when using HTTP-based clients (PlanetScale, Turso, Neon, etc.)
   */
  edge?: boolean;
}

export interface QueryContext<TClient> {
  client: TClient;
  table?: string;
  operation?: string;
  tags?: string[];
}

export interface NexusDBProvider<TClient> {
  /** The raw DB client — use directly in Server Actions */
  client: TClient;
  /**
   * Execute a cached query. Results are stored using Nexus's cache() system.
   * Tags are automatically derived from the table name.
   *
   * @example
   * const posts = await ctx.db.query('post', 'findMany', () =>
   *   ctx.db.client.post.findMany({ where: { published: true } })
   * );
   */
  query<T>(table: string, operation: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Execute a mutation and automatically invalidate related cache tags.
   *
   * @example
   * const post = await ctx.db.mutate('post', 'create', () =>
   *   ctx.db.client.post.create({ data })
   * );
   * // Automatically calls revalidate({ tags: ['post'] })
   */
  mutate<T>(table: string, operation: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Manually invalidate cache tags for a table.
   */
  invalidate(tables: string[]): Promise<void>;

  /**
   * Returns connection health info.
   */
  health(): Promise<{ ok: boolean; latency: number }>;
}

// ── Core factory ───────────────────────────────────────────────────────────────

/**
 * Wraps any DB client with Nexus's caching and invalidation layer.
 *
 * @example
 * // With Prisma
 * const db = defineDB(new PrismaClient(), { defaultTtl: 60 });
 *
 * // With Drizzle
 * const db = defineDB(drizzle(sql), { edge: true });
 *
 * // With any custom client
 * const db = defineDB(myCustomClient);
 */
export function defineDB<TClient>(
  client: TClient,
  opts: DBOptions<TClient> = {},
): NexusDBProvider<TClient> {
  const {
    tags: tagsFromTable = (t) => [t],
    defaultTtl = 0,
    beforeQuery,
    afterQuery,
  } = opts;

  return {
    client,

    async query<T>(table: string, operation: string, fn: () => Promise<T>): Promise<T> {
      const tags = tagsFromTable(table);
      const cacheKey = `db:${table}:${operation}`;

      const ctx: QueryContext<TClient> = { client, table, operation, tags };
      await beforeQuery?.(ctx);

      let result: T;
      if (defaultTtl > 0) {
        result = await cache(fn, { key: cacheKey, ttl: defaultTtl, tags });
      } else {
        result = await fn();
      }

      await afterQuery?.(ctx, result);
      return result;
    },

    async mutate<T>(table: string, operation: string, fn: () => Promise<T>): Promise<T> {
      const ctx: QueryContext<TClient> = { client, table, operation };
      await beforeQuery?.(ctx);

      const result = await fn();

      // Automatically invalidate all tags for this table
      await revalidate(tagsFromTable(table));
      await afterQuery?.(ctx, result);

      return result;
    },

    async invalidate(tables: string[]): Promise<void> {
      const allTags = tables.flatMap(tagsFromTable);
      await revalidate(allTags);
    },

    async health(): Promise<{ ok: boolean; latency: number }> {
      const start = Date.now();
      try {
        // Attempt a no-op query on common client shapes
        const c = client as Record<string, unknown>;
        if (typeof c['$queryRaw'] === 'function') {
          await (c['$queryRaw'] as (q: unknown) => Promise<unknown>)({ raw: 'SELECT 1' });
        } else if (typeof c['execute'] === 'function') {
          await (c['execute'] as (q: string) => Promise<unknown>)('SELECT 1');
        }
        return { ok: true, latency: Date.now() - start };
      } catch {
        return { ok: false, latency: Date.now() - start };
      }
    },
  };
}

// ── Serialization bridge ───────────────────────────────────────────────────────

/**
 * Serializes DB query results for safe transport over the wire.
 * Handles Date columns, BigInt IDs, Buffer fields (PostgreSQL bytea), etc.
 *
 * @example
 * const post = await db.client.post.findUnique({ where: { id } });
 * return serializeRecord(post); // Sends Date as ISO string, BigInt as string
 */
export function serializeRecord<T>(record: T): string {
  return serialize(record);
}

// ── Official adapters (re-exported for convenience) ───────────────────────────

export type { PrismaAdapter } from './adapters/prisma.js';
export type { DrizzleAdapter } from './adapters/drizzle.js';
export type { LibSQLAdapter } from './adapters/libsql.js';
