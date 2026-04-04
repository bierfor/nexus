# @nexus_js/sync

Nexus Local-First Sync — two tracks:

1. **`$localSync` / `syncEngine`** — IndexedDB + JSON ops queue + `fetch` flush (production-ready baseline).
2. **Byte-Mirror (prototype)** — SQLite WASM inside a **dedicated Web Worker**, with **OPFS** persistence when the host sends COOP/COEP headers (otherwise `:memory:` fallback).

## Byte-Mirror (SQLite worker)

```ts
import {
  ByteMirrorBridge,
  resolveSqliteSyncWorkerUrl,
} from '@nexus_js/sync';

const bridge = new ByteMirrorBridge(resolveSqliteSyncWorkerUrl());
await bridge.init();
await bridge.upsertNode({
  id: 'n1',
  flowId: 'f1',
  x: 120,
  y: 40,
  data: { label: 'Start' },
});
const rows = await bridge.listNodes('f1');
const outbox = await bridge.drainOutbox(20);
// POST `outbox[].frame_json` to your Server Action, then:
await bridge.markOutboxSynced(outbox.map((r) => r.id));
```

**Security:** the worker never executes arbitrary SQL from the page — only whitelisted ops (`UPSERT_NODE`, `DELETE_NODE`, …).

**OPFS:** for durable local SQLite, serve your app with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless` if compatible with your assets)

**Bundlers:** prefer `new Worker(new URL('@nexus_js/sync/workers/sqlite-sync.worker.js', import.meta.url), { type: 'module' })` or Vite’s `?worker` so `@sqlite.org/sqlite-wasm` and `.wasm` resolve correctly.

Next steps (not in this package yet): binary ChangeSet protocol, server-side merge / LWW, AES-GCM at rest, and a compiler-backed `$mirror` rune.

## Documentation

All guides, API reference, and examples live on **[nexusjs.dev](https://nexusjs.dev)**.

## Links

- **Website:** [https://nexusjs.dev](https://nexusjs.dev)
- **Repository:** [github.com/bierfor/nexus](https://github.com/bierfor/nexus) (see `packages/sync/`)
- **Issues:** [github.com/bierfor/nexus/issues](https://github.com/bierfor/nexus/issues)

## License

MIT © Nexus contributors
