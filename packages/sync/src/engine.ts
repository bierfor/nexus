/**
 * Nexus Local-First Sync Engine.
 *
 * Inspired by Replicache / ElectricSQL. Uses IndexedDB as the local store.
 *
 * Guarantees:
 *  - Writes are immediate (IndexedDB) — zero perceived latency for the user.
 *  - A "pending ops" queue is maintained. When online, ops are flushed to the
 *    server. When offline, they accumulate and are retried on reconnect.
 *  - Conflict resolution is pluggable via onConflict hook.
 *  - All pending ops survive page refreshes (persisted in IDB, not memory).
 */

const DB_NAME    = 'nexus_sync';
const DB_VERSION = 1;
const STORES     = { data: 'data', ops: 'pending_ops' } as const;

export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'error' | 'offline';

export interface SyncOp<T = unknown> {
  id:        string;           // uuid for idempotency
  store:     string;           // logical collection name
  type:      'put' | 'delete'; // operation type
  key:       string;           // record key within collection
  data?:     T;                // payload (undefined for deletes)
  ts:        number;           // client timestamp (for ordering)
  retries:   number;           // how many sync attempts have failed
}

export interface ConflictInfo<T> {
  local:    T;             // what the client has
  remote:   T;             // what the server returned
  op:       SyncOp<T>;    // the pending op that caused the conflict
}

export interface SyncCollectionOpts<T> {
  /** Server endpoint to flush ops to (POST). Receives `{ ops: SyncOp[] }`. */
  endpoint:    string;
  /**
   * Called when the server returns a conflict for an op.
   * Return the version that should win. Default: local wins.
   */
  onConflict?: (info: ConflictInfo<T>) => T | Promise<T>;
  /** Max retries before an op is moved to "dead letter" (logged, dropped). */
  maxRetries?: number;
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.data)) {
        db.createObjectStore(STORES.data);
      }
      if (!db.objectStoreNames.contains(STORES.ops)) {
        const ops = db.createObjectStore(STORES.ops, { keyPath: 'id' });
        ops.createIndex('store', 'store');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(req.error);
  });
}

// ── Sync Engine ───────────────────────────────────────────────────────────────

export class NexusSyncEngine {
  private db:        IDBDatabase | null = null;
  private flushing:  boolean            = false;
  private listeners: Set<() => void>    = new Set();
  status: SyncStatus = 'synced';

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await openDB();
    this.#startNetworkWatcher();
    // Flush any ops that survived a page refresh
    if (navigator.onLine) void this.flush();
  }

  private ensureDB(): IDBDatabase {
    if (!this.db) throw new Error('[Nexus Sync] Engine not initialized. Call await sync.init()');
    return this.db;
  }

  /** Read the local (IndexedDB) value for a key in a collection. */
  async get<T>(collection: string, key: string): Promise<T | undefined> {
    return idbGet<T>(this.ensureDB(), STORES.data, `${collection}:${key}`);
  }

  /** Read all values in a collection. */
  async getAll<T>(collection: string): Promise<T[]> {
    const db   = this.ensureDB();
    const all  = await idbGetAll<{ key: string; value: T }>(db, STORES.data);
    const prefix = `${collection}:`;
    return all
      .filter((r) => (r as unknown as { _idbKey?: string })._idbKey?.startsWith(prefix) ?? false)
      .map((r) => r.value);
  }

  /**
   * Write a value locally (instant) and enqueue a server sync op.
   * The UI is updated immediately — the server sync happens in the background.
   */
  async put<T>(
    collection: string,
    key:        string,
    value:      T,
    endpoint:   string,
  ): Promise<void> {
    const db = this.ensureDB();
    // 1. Persist locally
    await idbPut(db, STORES.data, `${collection}:${key}`, value);
    // 2. Enqueue sync op
    const op: SyncOp<T> = {
      id:      crypto.randomUUID(),
      store:   collection,
      type:    'put',
      key,
      data:    value,
      ts:      Date.now(),
      retries: 0,
    };
    await idbPut(db, STORES.ops, op.id, op);
    this.#setStatus('pending');
    this.#notify();
    // 3. Try to flush immediately if online
    if (navigator.onLine) void this.flush(endpoint);
  }

  /** Delete locally and enqueue a delete op. */
  async delete(collection: string, key: string, endpoint: string): Promise<void> {
    const db = this.ensureDB();
    await idbDelete(db, STORES.data, `${collection}:${key}`);
    const op: SyncOp = {
      id:      crypto.randomUUID(),
      store:   collection,
      type:    'delete',
      key,
      ts:      Date.now(),
      retries: 0,
    };
    await idbPut(db, STORES.ops, op.id, op);
    this.#setStatus('pending');
    this.#notify();
    if (navigator.onLine) void this.flush(endpoint);
  }

  /**
   * Flush pending ops to the server. Ops are sent in timestamp order.
   * On conflict, `onConflict` is called and the local store is updated.
   */
  async flush(endpoint?: string, opts?: Partial<SyncCollectionOpts<unknown>>): Promise<void> {
    if (this.flushing || !navigator.onLine) return;
    const db  = this.ensureDB();
    const ops = (await idbGetAll<SyncOp>(db, STORES.ops))
      .sort((a, b) => a.ts - b.ts);

    if (ops.length === 0) {
      this.#setStatus('synced');
      return;
    }

    this.flushing = true;
    this.#setStatus('syncing');

    const maxRetries = opts?.maxRetries ?? 5;
    const url = endpoint ?? ops[0]?.store ?? '';

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'x-nexus-sync': '1' },
        body:    JSON.stringify({ ops }),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const body = (await res.json()) as {
        acked:     string[];
        conflicts: Array<{ opId: string; serverValue: unknown }>;
      };

      // Acknowledge successful ops
      for (const id of body.acked ?? []) {
        await idbDelete(db, STORES.ops, id);
      }

      // Handle conflicts
      for (const conflict of body.conflicts ?? []) {
        const op = ops.find((o) => o.id === conflict.opId);
        if (!op) continue;
        if (opts?.onConflict) {
          const localValue  = await this.get(op.store, op.key);
          const winner = await opts.onConflict({
            local:  localValue as unknown,
            remote: conflict.serverValue,
            op,
          });
          await idbPut(db, STORES.data, `${op.store}:${op.key}`, winner);
        } else {
          // Default: local wins — re-enqueue with fresh timestamp
          const updated: SyncOp = { ...op, ts: Date.now() };
          await idbPut(db, STORES.ops, updated.id, updated);
        }
      }

      this.#setStatus('synced');
    } catch {
      // Increment retries on all remaining ops
      for (const op of ops) {
        const updated = { ...op, retries: op.retries + 1 };
        if (updated.retries >= maxRetries) {
          // Dead letter — drop and warn
          console.warn(`[Nexus Sync] Op ${op.id} exceeded max retries, dropping.`, op);
          await idbDelete(db, STORES.ops, op.id);
        } else {
          await idbPut(db, STORES.ops, op.id, updated);
        }
      }
      this.#setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      this.flushing = false;
      this.#notify();
    }
  }

  /** Returns the number of pending (unsynced) ops. */
  async pendingCount(): Promise<number> {
    const ops = await idbGetAll<SyncOp>(this.ensureDB(), STORES.ops);
    return ops.length;
  }

  /** Subscribe to status changes (useful for UI indicators). */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  #setStatus(s: SyncStatus): void {
    this.status = s;
  }

  #notify(): void {
    for (const cb of this.listeners) cb();
  }

  #startNetworkWatcher(): void {
    window.addEventListener('online', () => {
      if (window.__NEXUS_DEV__) {
        console.log('%c[Nexus Sync]%c 🟢 Back online — flushing pending ops...', 'color:#818cf8;font-weight:bold', 'color:#a3e635');
      }
      void this.flush();
    });
    window.addEventListener('offline', () => {
      this.#setStatus('offline');
      this.#notify();
      if (window.__NEXUS_DEV__) {
        console.log('%c[Nexus Sync]%c 🔴 Offline — writes queued in IndexedDB', 'color:#818cf8;font-weight:bold', 'color:#f87171');
      }
    });
  }
}

declare global {
  interface Window { __NEXUS_DEV__?: boolean; }
}

/** Singleton engine instance (shared across all $sync calls on a page). */
export const syncEngine = new NexusSyncEngine();
