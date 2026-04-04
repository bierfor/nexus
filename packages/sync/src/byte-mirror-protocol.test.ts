import { describe, it, expect } from 'vitest';
import type {
  SqliteSyncWorkerInboundMessage,
  SqliteSyncWorkerOutboundMessage,
} from './byte-mirror-protocol.js';

describe('byte-mirror-protocol', () => {
  it('round-trips representative inbound messages as JSON', () => {
    const messages: SqliteSyncWorkerInboundMessage[] = [
      { type: 'INIT', requestId: 'r1' },
      { type: 'INIT', requestId: 'r2', dbFilename: '/custom.sqlite' },
      {
        type:         'UPSERT_NODE',
        requestId:    'r3',
        payload:      { id: 'n1', flowId: 'f1', x: 1, y: 2, data: { label: 'a' } },
      },
      { type: 'DELETE_NODE', requestId: 'r4', payload: { id: 'n1' } },
      { type: 'LIST_NODES', requestId: 'r5', payload: { flowId: 'f1' } },
      { type: 'DRAIN_OUTBOX', requestId: 'r6', payload: { limit: 10 } },
      { type: 'MARK_OUTBOX_SYNCED', requestId: 'r7', payload: { ids: [1, 2] } },
    ];
    for (const m of messages) {
      const copy = JSON.parse(JSON.stringify(m)) as SqliteSyncWorkerInboundMessage;
      expect(copy).toEqual(m);
    }
  });

  it('round-trips representative outbound messages', () => {
    const out: SqliteSyncWorkerOutboundMessage[] = [
      { type: 'READY', requestId: 'a', storage: 'memory' },
      { type: 'READY', requestId: 'b', storage: 'opfs' },
      { type: 'ACK', requestId: 'c' },
      {
        type:      'NODES',
        requestId: 'd',
        rows:      [
          {
            id:         '1',
            flow_id:    'f',
            x:          0,
            y:          0,
            data_json:  '{}',
            updated_at: 1,
          },
        ],
      },
      { type: 'OUTBOX', requestId: 'e', rows: [{ id: 1, frame_json: '{}', created_at: 2 }] },
      { type: 'ERROR', requestId: 'f', message: 'x' },
    ];
    for (const m of out) {
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    }
  });
});
