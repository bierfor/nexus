/**
 * Main-thread bridge to the SQLite WASM sync worker (`workers/sqlite-sync.worker.ts`).
 */

import type {
  ByteMirrorStorageMode,
  FlowNodePayload,
  FlowNodeRow,
  OutboxRow,
  SqliteSyncWorkerInboundMessage,
  SqliteSyncWorkerOutboundMessage,
} from './byte-mirror-protocol.js';

/** Resolve the bundled worker script URL (works from `dist/index.js` in the published package). */
export function resolveSqliteSyncWorkerUrl(): URL {
  return new URL('./workers/sqlite-sync.worker.js', import.meta.url);
}

type Pending = { resolve: (msg: SqliteSyncWorkerOutboundMessage) => void; reject: (e: Error) => void };

/**
 * Typed façade over the SQLite WASM worker. Instantiate with
 * `new ByteMirrorBridge(resolveSqliteSyncWorkerUrl())` or a Vite `?worker` URL.
 */
export class ByteMirrorBridge {
  private readonly worker: Worker;
  private readonly pending = new Map<string, Pending>();

  constructor(workerUrl: URL | string) {
    const url = typeof workerUrl === 'string' ? workerUrl : workerUrl.href;
    this.worker = new Worker(url, { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<SqliteSyncWorkerOutboundMessage>) => {
      const data = ev.data;
      const p = this.pending.get(data.requestId);
      if (!p) return;
      this.pending.delete(data.requestId);
      if (data.type === 'ERROR') {
        p.reject(new Error(data.message));
        return;
      }
      p.resolve(data);
    };
    this.worker.onmessageerror = () => {
      this.#rejectAll(new Error('Worker message deserialization error'));
    };
    this.worker.addEventListener('error', (e) => {
      const err = e.error instanceof Error ? e.error : new Error('Worker crashed');
      this.#rejectAll(err);
    });
  }

  #rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  #post(msg: SqliteSyncWorkerInboundMessage): Promise<SqliteSyncWorkerOutboundMessage> {
    return new Promise((resolve, reject) => {
      this.pending.set(msg.requestId, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  /** Boot SQLite + schema. Call once before other methods. */
  async init(opts?: { dbFilename?: string }): Promise<{ storage: ByteMirrorStorageMode }> {
    const requestId = crypto.randomUUID();
    const initMsg: SqliteSyncWorkerInboundMessage =
      opts?.dbFilename !== undefined
        ? { type: 'INIT', requestId, dbFilename: opts.dbFilename }
        : { type: 'INIT', requestId };
    const res = await this.#post(initMsg);
    if (res.type !== 'READY') throw new Error(`[ByteMirror] expected READY, got ${res.type}`);
    return { storage: res.storage };
  }

  async upsertNode(payload: FlowNodePayload): Promise<void> {
    const requestId = crypto.randomUUID();
    const res = await this.#post({ type: 'UPSERT_NODE', requestId, payload });
    if (res.type !== 'ACK') throw new Error(`[ByteMirror] expected ACK, got ${res.type}`);
  }

  async deleteNode(id: string): Promise<void> {
    const requestId = crypto.randomUUID();
    const res = await this.#post({ type: 'DELETE_NODE', requestId, payload: { id } });
    if (res.type !== 'ACK') throw new Error(`[ByteMirror] expected ACK, got ${res.type}`);
  }

  async listNodes(flowId: string): Promise<FlowNodeRow[]> {
    const requestId = crypto.randomUUID();
    const res = await this.#post({ type: 'LIST_NODES', requestId, payload: { flowId } });
    if (res.type !== 'NODES') throw new Error(`[ByteMirror] expected NODES, got ${res.type}`);
    return res.rows;
  }

  /** Pull pending sync frames (JSON) to POST to your Server Action. */
  async drainOutbox(limit = 50): Promise<OutboxRow[]> {
    const requestId = crypto.randomUUID();
    const res = await this.#post({ type: 'DRAIN_OUTBOX', requestId, payload: { limit } });
    if (res.type !== 'OUTBOX') throw new Error(`[ByteMirror] expected OUTBOX, got ${res.type}`);
    return res.rows;
  }

  /** After the server ACKs frames, remove them from the local outbox. */
  async markOutboxSynced(ids: number[]): Promise<void> {
    const requestId = crypto.randomUUID();
    const res = await this.#post({ type: 'MARK_OUTBOX_SYNCED', requestId, payload: { ids } });
    if (res.type !== 'ACK') throw new Error(`[ByteMirror] expected ACK, got ${res.type}`);
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
