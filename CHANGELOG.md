# Changelog

All notable changes to Nexus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-04-03

### Added

**`@nexus/router` — Multi-Tenant First-Class Support**
- `extractTenant(request, config)` — extracts tenant from subdomain, custom domain, or URL path
- `TenantConfig` type with `mode`, `baseDomain`, `pathPrefix`, `resolve`, and `fallback` options
- `scopeTenantKey(tenant, key)` — scopes Shield Cache keys per tenant, preventing cross-tenant data leaks
- `tenantHeaders(tenant)` — generates `x-nexus-tenant`, `x-nexus-tenant-domain` headers for CDN routing
- `tenantVaryHeader(mode)` — generates correct `Vary` header for CDN cache isolation per tenant
- All exports available via `@nexus/router`
- Supports `'subdomain'`, `'custom-domain'`, and `'path'` tenancy modes
- Optional async `resolve` function for loading tenant metadata (plan, name, logo) from your DB

**`@nexus/sync` — Local-First Sync Engine**
- `NexusSyncEngine` class — IndexedDB-backed operation queue with background server sync
- Writes are instant (IndexedDB) with zero perceived latency for the user
- Pending ops survive page refreshes — stored in IDB, not memory
- Network watcher: auto-flushes on `online` event; marks `offline` on disconnect
- Configurable conflict resolution: `onConflict` hook receives `{ local, remote, op }`, return the winning value
- Dead-letter queue: ops that exceed `maxRetries` are dropped with a warning, not retried forever
- `$localSync<T>(collection, opts)` rune — reactive Local-First state container:
  - `value` — current local value (reflects all mutations immediately)
  - `status` — `'synced' | 'pending' | 'syncing' | 'error' | 'offline'`
  - `pending` — count of unsynced ops
  - `set(next)`, `push(item)`, `remove(predicate)` — instant local mutations with background sync
  - `flush()` — force immediate sync attempt
  - `subscribe(cb)` — reactive change notifications
- `isOnline()` and `waitForOnline()` utilities

**`@nexus/ui` — Zero-Bundle CSS-Only Components**
- Every component generates pure HTML+CSS — 0.0 bytes of JavaScript shipped
- Nexus compiler detects `@zero-bundle` annotation and replaces components at build time
- Works with JavaScript disabled in the browser
- Components:
  - `Accordion` — `<details>/<summary>` with smooth animation
  - `Tabs` — CSS `:target` pseudo-class for tab switching
  - `Tooltip` — CSS `:hover` + `aria-label`
  - `Modal` — CSS `:target` modal (no JS needed)
  - `ProgressRing` — Pure SVG animated progress indicator
- `getZeroBundleCSS()` — returns the complete component stylesheet for injection into `<head>`
- All styles use `@layer nexus.ui` for safe cascade management

**`examples/pokedex` — Local-First Offline Demo**
- Battle capture now uses `@nexus/sync` pattern: IndexedDB write first, server sync second
- `/_nexus/sync` POST endpoint — receives sync ops, acks/conflicts back to client
- `/_nexus/sync/captures` GET endpoint — returns server-side capture state
- `handleSyncOps(ops)` — server-side op handler with conflict detection
- Offline indicator badge in BattleMode UI showing `🟢 Online` / `🔴 Offline`
- Sync status label shows `🔄 Syncing...` → `✅ Synced with server`
- Auto-sync on `online` event — captures made offline sync automatically when connection returns
- Connect channel receives `source: 'sync'` flag from synced captures, global counter updates live
- IndexedDB fallback to direct POST if IDB is unavailable
- Dev Console: `[Nexus Sync]` log group for all IDB and sync events

---

## [0.2.0] — 2026-04-03

### Added

**`@nexus/server` — Production-grade request pipeline**
- `RequestLogInfo` interface: structured per-request data (method, path, status, duration, cacheStrategy, isAction)
- `onRequest` hook in `NexusServerOptions` — lets the CLI (or any host) receive request events without coupling ANSI formatting to the server package
- `cacheStrategy` field populated from `x-nexus-cache-strategy` renderer header and exposed via the hook
- `isAction` flag to distinguish Server Action traffic in logs
- Detailed dev-mode error page in the browser with stack trace `<details>` block
- Detailed dev-mode error output in the terminal with stack trace (first 5 frames)
- `listen()` now returns `Promise<void>` — resolves when the port is bound; callers can `await` before printing the banner

### Changed

**`@nexus/cli` — Developer Experience overhaul (DX 2.0)**
- `nexus dev` now shows a Vite-style ANSI startup banner: `◆ NEXUS v0.2.0  ready in Xms` with local URL
- `nexus dev` prints a request access log for every request: timestamp · method · path · status · duration · cache tag (`⚡ cached`, `🌐 dynamic`, `🔒 private`, `⚡ action`)
- `nexus dev` file watcher now debounces at 100ms and logs `[HMR] filename event — reloading routes` on every `.nx`/`.ts` change
- `nexus dev` prints `◆ Nexus stopped` on Ctrl+C
- `nexus build` shows compilation time alongside route count
- `nexus start` shows the same startup banner as dev mode (without Studio URL)
- `nexus check` uses unified ANSI color system; prints `✖ Type errors found` on failure

**Internal**
- Unified ANSI color constants `c` object in `packages/cli/src/bin.ts` — consistent palette across all commands
- `listen()` return type changed from `void` to `Promise<void>` (non-breaking for `await server.listen()` usage)

**Pokédex example (`examples/pokedex`)**
- Dev server port changed from `3456` → `3000`
- `node --watch --watch-path=./src` hot-restart built into `pnpm dev`
- Same Vite-style banner and request access log as the real CLI
- Browser error overlay with collapsible stack trace on 500 responses
- Added `npm run dev:pokedex` and `npm run dev:all` to root `package.json`

### Fixed
- Server `listen()` was printing its own banner unconditionally — now the banner is the CLI's responsibility, keeping the server package presentation-agnostic

---

## [0.1.0] — 2026-04-03

### Added

**Core Architecture**
- Islands Architecture: zero JS by default, progressive hydration per component
- Svelte 5 Runes: `$state`, `$derived`, `$effect`, `$props`, `batch`
- File-based routing with nested layouts, dynamic segments, route groups
- `.nx` component format: server frontmatter + reactive script + template + scoped styles
- Partial Pre-Rendering (PPR): static shell with dynamic Suspense holes
- Edge runtime compatibility via Web-standard `Request`/`Response` APIs

**Packages**
- `@nexus/compiler` — `.nx` → JS transform with AOT CSS scoping (`@layer nexus.scoped`) and island preload scanner
- `@nexus/runtime` — Runes engine, island hydration, global state store, SPA navigation (Server-Driven DOM Morphing), cache, optimistic UI, `$sync` rune
- `@nexus/server` — HTTP server, SSR renderer with auto Edge-Cache headers, streaming SSR with Suspense, file-based error boundaries, Server Actions with AbortController and race condition strategies
- `@nexus/router` — File-based route manifest builder
- `@nexus/cli` — `nexus dev/build/start/studio/check/routes/analyze` + `create-nexus` scaffolder + Nexus Studio dashboard
- `@nexus/assets` — AVIF/WebP image optimization with srcset and blur placeholder; Google/local font optimization
- `@nexus/head` — `defineHead()` and `useHead()` for SEO metadata management
- `@nexus/middleware` — Web-standard middleware (CORS, rate limit, auth, geo, security headers) with Cloudflare/Vercel adapters
- `@nexus/serialize` — SuperJSON-like serializer for `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `URL`, `Uint8Array`, `undefined`, `NaN`, `Infinity`, `Error`
- `@nexus/types` — E2E type generation for routes, params, and Server Actions
- `@nexus/testing` — `renderSSR`, `mountIsland`, `createActionTestHarness` for Vitest/Playwright
- `@nexus/vite-plugin-nexus` — Vite plugin for HMR, CSS preprocessing, island manifest emission
- `@nexus/db` — BYOD thin provider adapter with Prisma, Drizzle, and libSQL/Turso adapters

**DX Features**
- Nexus Studio: real-time dev dashboard (Layout Tree, Island Map, Action Log, Cache Inspector, Store Viewer)
- Bundle Budget Analyzer: per-route JS cost report with gzip estimates
- E2E type safety: `nexus-types.d.ts` auto-generated from route and action signatures
- Global State Store with `session` and `url` persistence modes; Hydration Miss = 0
- Smart `Cache-Control` headers computed from `cache()` TTL aggregation
- AbortController-based action cancellation with `cancel | queue | reject | ignore` strategies
- Idempotency key deduplication for Server Actions

**Documentation**
- Multilingual landing page (ES/EN/PT) at `docs/index.html`
- Comprehensive README with architecture overview, API reference, and deployment guide
- Contributing guide and Code of Conduct

---

*Initial release — specification-grade implementation of all core framework concepts.*
