/**
 * @nexus_js/db/adapters/libsql — Turso/libSQL adapter.
 *
 * libSQL is the Edge-native SQLite database. This adapter provides:
 *   - Typed query helpers wrapping the libSQL client
 *   - Automatic batch support for multi-statement transactions
 *   - Integration with Nexus cache (TTL-based row caching)
 *
 * @example
 * import { createClient } from '@libsql/client';
 * import { libsqlAdapter } from '@nexus_js/db/adapters/libsql';
 *
 * export const db = libsqlAdapter(createClient({
 *   url: process.env.TURSO_URL!,
 *   authToken: process.env.TURSO_TOKEN,
 * }));
 */

import { defineDB } from '../index.js';
import type { NexusDBProvider } from '../index.js';

export interface LibSQLClient {
  execute: (stmt: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[] }>;
  batch?: (stmts: { sql: string; args?: unknown[] }[]) => Promise<{ rows: unknown[] }[]>;
}

export interface LibSQLAdapterOptions {
  defaultTtl?: number;
}

export interface LibSQLAdapter extends NexusDBProvider<LibSQLClient> {
  libsql: LibSQLClient;
  /**
   * Execute a raw SQL statement and return typed rows.
   */
  sql<T = Record<string, unknown>>(
    query: string,
    args?: unknown[],
  ): Promise<T[]>;
  /**
   * Execute multiple statements in a batch (atomic in Turso).
   */
  batch(stmts: { sql: string; args?: unknown[] }[]): Promise<unknown[][]>;
}

export function libsqlAdapter(
  client: LibSQLClient,
  opts: LibSQLAdapterOptions = {},
): LibSQLAdapter {
  const base = defineDB(client, {
    tags: (table) => [table],
    edge: true,
    defaultTtl: opts.defaultTtl ?? 0,
  });

  return {
    ...base,
    libsql: client,

    async sql<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
      const result = await client.execute({ sql, args });
      return result.rows as T[];
    },

    async batch(stmts): Promise<unknown[][]> {
      if (!client.batch) {
        throw new Error('This libSQL client does not support batch operations.');
      }
      const results = await client.batch(stmts);
      return results.map((r) => r.rows);
    },

    async health() {
      const start = Date.now();
      try {
        await client.execute({ sql: 'SELECT 1' });
        return { ok: true, latency: Date.now() - start };
      } catch {
        return { ok: false, latency: Date.now() - start };
      }
    },
  };
}
