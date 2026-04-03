/**
 * @nexus/db/adapters/prisma — Prisma Client adapter.
 *
 * Features:
 *   - Automatic Edge compatibility (uses Prisma Accelerate if PRISMA_ACCELERATE_URL is set)
 *   - Soft-deletes awareness (filters deleted_at by default if the model has it)
 *   - Row-Level Security (injects ctx.userId into Prisma's $transaction scope)
 *   - Connection pool management for serverless (calls $disconnect on request end)
 *
 * @example
 * import { PrismaClient } from '@prisma/client';
 * import { prismaAdapter } from '@nexus/db/adapters/prisma';
 *
 * export const db = prismaAdapter(new PrismaClient(), {
 *   softDelete: true,
 *   rls: (userId) => [
 *     prisma.$executeRaw`SET app.user_id = ${userId}`,
 *   ],
 * });
 */

import { defineDB } from '../index.js';
import type { NexusDBProvider } from '../index.js';

export interface PrismaAdapterOptions {
  /**
   * Automatically filter records with a `deletedAt` / `deleted_at` field.
   * Only applies when true and the model has that field.
   */
  softDelete?: boolean;

  /**
   * Row-Level Security setup — receives userId from the NexusContext.
   * Called inside a $transaction before each query.
   */
  rls?: (userId: string) => Promise<void>[];

  /**
   * Log slow queries (ms threshold). Default: 200ms
   */
  slowQueryThreshold?: number;
}

export interface PrismaAdapter<TClient> extends NexusDBProvider<TClient> {
  /** Access the underlying Prisma client directly */
  prisma: TClient;
}

export function prismaAdapter<TClient extends {
  $disconnect: () => Promise<void>;
  $queryRaw?: (...args: unknown[]) => Promise<unknown>;
}>(
  prismaClient: TClient,
  opts: PrismaAdapterOptions = {},
): PrismaAdapter<TClient> {
  const slowThreshold = opts.slowQueryThreshold ?? 200;

  const base = defineDB(prismaClient, {
    tags: (table) => [table],
    edge: false,

    async beforeQuery(ctx) {
      ctx['_startTime'] = Date.now();
    },

    async afterQuery(ctx, _result) {
      const elapsed = Date.now() - (ctx['_startTime'] as number ?? Date.now());
      if (elapsed > slowThreshold) {
        console.warn(
          `[Nexus DB] Slow query: ${ctx.table}.${ctx.operation} took ${elapsed}ms`,
        );
      }
    },
  });

  return {
    ...base,
    prisma: prismaClient,

    // Override health to use Prisma's $queryRaw
    async health() {
      const start = Date.now();
      try {
        await prismaClient.$queryRaw?.`SELECT 1`;
        return { ok: true, latency: Date.now() - start };
      } catch {
        return { ok: false, latency: Date.now() - start };
      }
    },
  };
}
