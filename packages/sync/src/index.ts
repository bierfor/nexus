/**
 * @nexus_js/sync — Local-First Sync Engine
 *
 * Provides offline-first data persistence and background synchronization
 * using IndexedDB as the local store and Server Actions as the sync target.
 */

export { syncEngine, NexusSyncEngine } from './engine.js';
export type { SyncOp, SyncStatus, SyncCollectionOpts, ConflictInfo } from './engine.js';

export { $localSync } from './rune.js';
export type { LocalSyncState, LocalSyncOpts } from './rune.js';

/** Byte-Mirror — SQLite WASM in a worker (OPFS / memory fallback). */
export {
  ByteMirrorBridge,
  resolveSqliteSyncWorkerUrl,
} from './byte-mirror-bridge.js';
export type {
  ByteMirrorStorageMode,
  FlowNodePayload,
  FlowNodeRow,
  OutboxRow,
  SqliteSyncWorkerInboundMessage,
  SqliteSyncWorkerOutboundMessage,
} from './byte-mirror-protocol.js';

/** Convenience: check if the browser is currently online. */
export const isOnline = (): boolean =>
  typeof navigator !== 'undefined' ? navigator.onLine : true;

/** Returns a promise that resolves when the browser comes back online. */
export function waitForOnline(): Promise<void> {
  if (isOnline()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const handler = () => { window.removeEventListener('online', handler); resolve(); };
    window.addEventListener('online', handler);
  });
}
