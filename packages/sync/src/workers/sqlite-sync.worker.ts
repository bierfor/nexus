/**
 * Nexus Byte-Mirror — SQLite WASM worker (OPFS when COOP/COEP allow it, else :memory:).
 *
 * Security: accepts only structured mutation messages — never raw SQL strings from the UI.
 */
/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type {
  SqliteSyncWorkerInboundMessage,
  SqliteSyncWorkerOutboundMessage,
  FlowNodePayload,
} from '../byte-mirror-protocol.js';

type SqliteDb = {
  exec: (...args: unknown[]) => unknown;
  prepare: (sql: string) => SqliteStmt;
  close: () => void;
};

type SqliteStmt = {
  bind(idx: number, value: unknown): unknown;
  step: () => boolean;
  finalize: () => void;
};

let db: SqliteDb | null = null;

function reply(msg: SqliteSyncWorkerOutboundMessage): void {
  self.postMessage(msg);
}

function ensureDb(): SqliteDb {
  if (!db) throw new Error('[Nexus Byte-Mirror] Worker not initialized (send INIT first)');
  return db;
}

function runSchema(d: SqliteDb): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS nexus_flow_nodes (
      id TEXT PRIMARY KEY NOT NULL,
      flow_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nexus_flow_nodes_flow ON nexus_flow_nodes(flow_id);
  `);
  d.exec(`
    CREATE TABLE IF NOT EXISTS nexus_sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      frame_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function enqueueOutbox(frame: Record<string, unknown>): void {
  const d = ensureDb();
  const stmt = d.prepare(`INSERT INTO nexus_sync_outbox (frame_json, created_at) VALUES (?1, ?2)`);
  try {
    stmt.bind(1, JSON.stringify(frame));
    stmt.bind(2, Date.now());
    while (stmt.step()) {
      /* drain */
    }
  } finally {
    stmt.finalize();
  }
}

function upsertNode(payload: FlowNodePayload): void {
  const d = ensureDb();
  const dataJson = JSON.stringify(payload.data ?? {});
  const stmt = d.prepare(`
    INSERT INTO nexus_flow_nodes (id, flow_id, x, y, data_json, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(id) DO UPDATE SET
      flow_id = excluded.flow_id,
      x = excluded.x,
      y = excluded.y,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `);
  try {
    stmt.bind(1, payload.id);
    stmt.bind(2, payload.flowId);
    stmt.bind(3, payload.x);
    stmt.bind(4, payload.y);
    stmt.bind(5, dataJson);
    stmt.bind(6, Date.now());
    while (stmt.step()) {
      /* drain */
    }
  } finally {
    stmt.finalize();
  }
  enqueueOutbox({ kind: 'upsert_node', ...payload, data: payload.data ?? {} });
}

function deleteNode(id: string): void {
  const d = ensureDb();
  const stmt = d.prepare(`DELETE FROM nexus_flow_nodes WHERE id = ?1`);
  try {
    stmt.bind(1, id);
    while (stmt.step()) {
      /* drain */
    }
  } finally {
    stmt.finalize();
  }
  enqueueOutbox({ kind: 'delete_node', id });
}

function listNodes(flowId: string): ReturnType<typeof Object>[] {
  const d = ensureDb();
  const rows = d.exec({
    sql: `SELECT id, flow_id, x, y, data_json, updated_at FROM nexus_flow_nodes WHERE flow_id = ?1 ORDER BY id`,
    bind: [flowId],
    returnValue: 'resultRows',
    rowMode: 'object',
  }) as Array<Record<string, unknown>>;
  return rows ?? [];
}

function drainOutbox(limit: number): Array<{ id: number; frame_json: string; created_at: number }> {
  const d = ensureDb();
  const rows = d.exec({
    sql: `SELECT id, frame_json, created_at FROM nexus_sync_outbox ORDER BY id ASC LIMIT ?1`,
    bind: [limit],
    returnValue: 'resultRows',
    rowMode: 'object',
  }) as Array<{ id: number; frame_json: string; created_at: number }>;
  return rows ?? [];
}

function markOutboxSynced(ids: number[]): void {
  if (ids.length === 0) return;
  const d = ensureDb();
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  const stmt = d.prepare(`DELETE FROM nexus_sync_outbox WHERE id IN (${placeholders})`);
  try {
    for (let i = 0; i < ids.length; i++) {
      stmt.bind(i + 1, ids[i]);
    }
    while (stmt.step()) {
      /* drain */
    }
  } finally {
    stmt.finalize();
  }
}

async function handleInit(requestId: string, dbFilename?: string): Promise<void> {
  const sqlite3 = await sqlite3InitModule({
    print:    () => undefined,
    printErr: (m: unknown) => console.error('[sqlite-wasm]', m),
  });

  const oo1 = sqlite3.oo1 as {
    OpfsDb?: new (name: string, flags?: string) => SqliteDb;
    DB: new (name?: string, flags?: string, vfs?: string) => SqliteDb;
  };

  const file = dbFilename ?? '/nexus_byte_mirror.sqlite';
  let storage: 'opfs' | 'memory' = 'memory';

  try {
    const OpfsDb = oo1.OpfsDb;
    if (OpfsDb) {
      db = new OpfsDb(file, 'c');
      storage = 'opfs';
    } else {
      db = new oo1.DB(':memory:');
    }
  } catch {
    db = new oo1.DB(':memory:');
    storage = 'memory';
  }

  runSchema(db);
  reply({ type: 'READY', requestId, storage });
}

self.onmessage = async (ev: MessageEvent<SqliteSyncWorkerInboundMessage>) => {
  const msg = ev.data;
  const requestId = msg.requestId;

  try {
    switch (msg.type) {
      case 'INIT':
        await handleInit(requestId, msg.dbFilename);
        break;

      case 'UPSERT_NODE':
        ensureDb();
        upsertNode(msg.payload);
        reply({ type: 'ACK', requestId });
        break;

      case 'DELETE_NODE':
        ensureDb();
        deleteNode(msg.payload.id);
        reply({ type: 'ACK', requestId });
        break;

      case 'LIST_NODES': {
        ensureDb();
        const raw = listNodes(msg.payload.flowId) as Array<{
          id: unknown;
          flow_id: unknown;
          x: unknown;
          y: unknown;
          data_json: unknown;
          updated_at: unknown;
        }>;
        const rows = raw.map((r) => ({
          id:        String(r.id),
          flow_id:   String(r.flow_id),
          x:         Number(r.x),
          y:         Number(r.y),
          data_json: String(r.data_json ?? '{}'),
          updated_at: Number(r.updated_at),
        }));
        reply({ type: 'NODES', requestId, rows });
        break;
      }

      case 'DRAIN_OUTBOX': {
        ensureDb();
        const rows = drainOutbox(Math.max(1, Math.min(500, msg.payload.limit)));
        reply({ type: 'OUTBOX', requestId, rows });
        break;
      }

      case 'MARK_OUTBOX_SYNCED': {
        ensureDb();
        markOutboxSynced(msg.payload.ids);
        reply({ type: 'ACK', requestId });
        break;
      }

      default:
        reply({ type: 'ERROR', requestId, message: 'Unknown worker message type' });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    reply({ type: 'ERROR', requestId, message });
  }
};
