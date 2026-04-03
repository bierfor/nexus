# Changelog

All notable changes to Nexus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
