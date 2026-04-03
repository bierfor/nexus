/**
 * $localSync — the Local-First reactive rune.
 *
 * Usage (inside a .nx island):
 *
 * ```ts
 * import { $localSync } from '@nexus/sync';
 *
 * const captures = $localSync<string[]>('my-captures', {
 *   default: [],
 *   endpoint: '/_nexus/action/sync-captures',
 *   onConflict: ({ local, remote }) => [...new Set([...local, ...remote])],
 * });
 *
 * // Read — always reflects local IndexedDB state
 * console.log(captures.value);
 *
 * // Mutate — instant UI update, background server sync
 * await captures.add('pikachu');
 * await captures.remove('pikachu');
 * ```
 *
 * The framework automatically:
 *  - Persists every mutation to IndexedDB (works offline).
 *  - Syncs to the server when online.
 *  - Retries failed syncs on reconnect.
 *  - Calls onConflict if the server disagrees.
 */

import { syncEngine, type SyncCollectionOpts, type SyncStatus } from './engine.js';

let engineReady: Promise<void> | null = null;

function ensureEngine(): Promise<void> {
  if (!engineReady) engineReady = syncEngine.init();
  return engineReady;
}

export interface LocalSyncState<T> {
  /** Current value (IndexedDB, reflects all local mutations immediately). */
  readonly value: T;
  /** Current sync status. */
  readonly status: SyncStatus;
  /** Pending op count. */
  readonly pending: number;
  /** Overwrite entire value and enqueue a sync op. */
  set(next: T): Promise<void>;
  /**
   * Array helpers — only valid when T extends unknown[].
   * push/remove mutate the local array atomically.
   */
  push(item: T extends (infer I)[] ? I : never): Promise<void>;
  remove(predicate: T extends (infer I)[] ? (item: I) => boolean : never): Promise<void>;
  /** Force an immediate flush attempt. */
  flush(): Promise<void>;
  /** Subscribe to value/status changes (returns unsubscribe fn). */
  subscribe(cb: (state: LocalSyncState<T>) => void): () => void;
}

export interface LocalSyncOpts<T> extends Partial<SyncCollectionOpts<T>> {
  /** Default value used before IndexedDB is ready. */
  default: T;
  /** Server endpoint to sync ops to. */
  endpoint: string;
  /**
   * Unique key for this value within the collection.
   * Defaults to 'default'. Useful to scope per-user data.
   */
  key?: string;
}

/**
 * Creates a Local-First reactive state container.
 * The returned object is reactive — UI should re-render on .value access
 * (integration with Svelte 5 Runes happens at the compiler layer).
 */
export function $localSync<T>(
  collection: string,
  opts:       LocalSyncOpts<T>,
): LocalSyncState<T> {
  const storeKey = opts.key ?? 'default';
  let   current  = opts.default;
  let   status:  SyncStatus = 'synced';
  let   pending  = 0;
  const subs     = new Set<(s: LocalSyncState<T>) => void>();

  function notify(): void {
    for (const cb of subs) cb(state);
  }

  // Load initial value from IndexedDB
  ensureEngine().then(async () => {
    const stored = await syncEngine.get<T>(collection, storeKey);
    if (stored !== undefined) {
      current = stored;
      notify();
    }
    // Track engine status
    syncEngine.subscribe(async () => {
      status  = syncEngine.status;
      pending = await syncEngine.pendingCount();
      notify();
    });
  });

  const state: LocalSyncState<T> = {
    get value()   { return current; },
    get status()  { return status; },
    get pending() { return pending; },

    async set(next: T): Promise<void> {
      current = next;
      notify();
      await ensureEngine();
      await syncEngine.put(collection, storeKey, next, opts.endpoint);
    },

    async push(item): Promise<void> {
      if (!Array.isArray(current)) throw new Error('[Nexus Sync] .push() requires an array value');
      await state.set([...current, item] as T);
    },

    async remove(predicate): Promise<void> {
      if (!Array.isArray(current)) throw new Error('[Nexus Sync] .remove() requires an array value');
      await state.set((current as unknown[]).filter((i) => !(predicate as (x: unknown) => boolean)(i)) as T);
    },

    async flush(): Promise<void> {
      await ensureEngine();
      await syncEngine.flush(opts.endpoint, opts as Partial<SyncCollectionOpts<unknown>>);
    },

    subscribe(cb): () => void {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };

  return state;
}
