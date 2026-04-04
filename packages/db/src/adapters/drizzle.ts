/**
 * @nexus_js/db/adapters/drizzle — Drizzle ORM adapter.
 *
 * Drizzle is schema-first, SQL-native, and Edge-native by default.
 * This adapter wires it to Nexus's cache() and revalidate() system.
 *
 * @example
 * import { drizzle } from 'drizzle-orm/postgres-js';
 * import postgres from 'postgres';
 * import { drizzleAdapter } from '@nexus_js/db/adapters/drizzle';
 * import * as schema from './schema';
 *
 * const sql = postgres(process.env.DATABASE_URL!);
 * export const db = drizzleAdapter(drizzle(sql, { schema }), {
 *   schema,
 *   edge: true,
 * });
 */

import { defineDB } from '../index.js';
import type { NexusDBProvider } from '../index.js';

export interface DrizzleAdapterOptions<TSchema> {
  schema?: TSchema;
  /** Set to true if using an HTTP-based driver (PlanetScale, Neon serverless, Turso) */
  edge?: boolean;
}

export interface DrizzleAdapter<TClient> extends NexusDBProvider<TClient> {
  /** The raw Drizzle client */
  drizzle: TClient;
}

export function drizzleAdapter<TClient>(
  drizzleClient: TClient,
  opts: DrizzleAdapterOptions<unknown> = {},
): DrizzleAdapter<TClient> {
  const base = defineDB(drizzleClient, {
    tags: (table) => [table],
    edge: opts.edge ?? false,
    defaultTtl: 0,
  });

  return {
    ...base,
    drizzle: drizzleClient,
  };
}
