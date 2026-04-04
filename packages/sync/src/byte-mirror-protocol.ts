/**
 * Byte-Mirror — typed messages between the main thread and the SQLite sync worker.
 * No arbitrary SQL crosses this boundary: only whitelisted mutation kinds (see worker).
 */

export type ByteMirrorStorageMode = 'opfs' | 'memory';

/** Payload for flow-editor style nodes (NexusFlow-oriented). */
export interface FlowNodePayload {
  id: string;
  flowId: string;
  x: number;
  y: number;
  /** Extra JSON-serializable fields (ports, label, etc.) */
  data?: Record<string, unknown>;
}

export type SqliteSyncWorkerInboundMessage =
  | { type: 'INIT'; requestId: string; dbFilename?: string }
  | { type: 'UPSERT_NODE'; requestId: string; payload: FlowNodePayload }
  | { type: 'DELETE_NODE'; requestId: string; payload: { id: string } }
  | { type: 'LIST_NODES'; requestId: string; payload: { flowId: string } }
  | { type: 'DRAIN_OUTBOX'; requestId: string; payload: { limit: number } }
  | { type: 'MARK_OUTBOX_SYNCED'; requestId: string; payload: { ids: number[] } };

export type FlowNodeRow = {
  id: string;
  flow_id: string;
  x: number;
  y: number;
  data_json: string;
  updated_at: number;
};

export type OutboxRow = { id: number; frame_json: string; created_at: number };

export type SqliteSyncWorkerOutboundMessage =
  | { type: 'READY'; requestId: string; storage: ByteMirrorStorageMode }
  | { type: 'ACK'; requestId: string }
  | { type: 'NODES'; requestId: string; rows: FlowNodeRow[] }
  | { type: 'OUTBOX'; requestId: string; rows: OutboxRow[] }
  | { type: 'ERROR'; requestId: string; message: string };
