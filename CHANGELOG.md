# Changelog

All notable changes to Nexus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.0] — 2026-04-04

### Changed

- Workspace and all `packages/*` framework packages aligned to **0.7.0** (`@nexus_js/*`, `vite-plugin-nexus`).
- Publishing workflow: `pnpm release`, `pnpm version:framework`, and [docs/PUBLISHING.md](./docs/PUBLISHING.md).

## [0.6.0] — 2026-04-03

### Added

**`@nexus_js/audit` — Integrated Dependency Auditing Engine (new package)**

*CVE Scanning via Google OSV (`src/engine.ts`)*
- `auditPackage(pkg, version?)` — queries `api.osv.dev` for known CVEs, no API key required
- `auditDependencies(deps)` — parallel batch scanning (max 6 concurrent) of all dependencies
- `filterVulnerable(results)` — returns only vulnerable packages sorted by severity
- **Offline-first**: responses cached in `~/.nexus/cache/osv/{pkg}.json` for 24h
- Transparent fallback to stale cache when offline (no build failure on airplane mode)
- CVSS v3/v4 score parsing for precise `critical/high/medium/low/unknown` classification
- `fixedIn` field extracted from OSV range data for `nexus fix` remediation
- `invalidateCache(pkg)` and `clearCache()` for cache management

*Supply Chain Guard (`src/supply-chain.ts`)*
- `checkSupplyChain(pkg)` — queries npm registry for risk signals
- Risk signals analyzed: single maintainer, newly published (<30 days), abandoned (>2 years), rapid version publishing (≥5 versions in 7 days), high churn on new packages
- Risk score: 0–100 → `safe/low/medium/high/critical` risk levels
- Results cached in `~/.nexus/cache/npm-meta/{pkg}.json` for 6h
- Transparent note about MFA status: npm does not expose individual MFA status via public API (see `MFA_NOTE` export)
- `auditSupplyChain(deps)` — batch scan returning only `medium/high/critical` risk packages

*Override Policy (`src/override.ts`)*
- `VulnerabilityOverride` — `{ cve, reason, expires }` configuration type
- `validateOverride(pkg, override)` — checks expiry, returns `daysLeft`, `expired`, and formatted message
- `findOverride(pkg, cveId, overrides)` — matches override by CVE ID (case-insensitive, partial match)
- Overrides expire automatically — build fails again after the date without any code changes
- Warning 14 days before expiry, error on expiry day
- `formatOverrides(overrides)` — groups by active / expiring-soon / expired for audit display
- `maxOverrideDate()` — returns max allowed expiry (180 days) to prevent permanent exceptions

**`packages/vite-plugin-nexus/src/security.ts` — Compiler-Level CVE Blocking**
- `nexusSecurity(opts)` — Vite plugin with `mode: 'off' | 'warn' | 'block' | 'paranoid'`
- `buildStart` hook: scans all dependencies once at Vite startup (not per-import)
- `resolveId` hook: catches dynamic imports not in package.json
- `block` mode: `this.error()` stops the build entirely for critical CVEs
- `paranoid` mode: blocks critical + high, warns for medium
- Supply chain risk warnings for `high/critical` packages in the build log
- Override expiry enforcement: `this.error()` if expired override detected
- Full ANSI-colored block message with CVE details, fix version, and `nexus fix` CTA

**`packages/cli/src/fix.ts` — `nexus fix` Auto-Remediation**
- Reads package.json, queries OSV for vulnerable packages
- Finds `fixedIn` version from OSV data and runs `pnpm/npm/yarn add pkg@version`
- Auto-detects package manager via lockfile detection
- Preserves semver range prefix (`^`, `~`) from existing version spec
- `--dry-run` mode: shows what would be updated without writing changes
- `--force` flag: also fix medium/low severity (not just critical/high)
- Re-audits after fixing to confirm remaining vulnerabilities
- Reports packages with no available fix (no `fixedIn` in OSV data)

**`packages/cli/src/bin.ts` — Background Audit in `nexus dev`**
- Runs CVE + supply chain check silently after server starts (non-blocking)
- Prints color-coded warning if critical/high vulnerabilities found
- Prints supply chain risk warnings for high/critical risk packages
- Never kills the dev server — audit failures are silently ignored
- New `nexus fix` command registered with `--dry-run` and `--force` flags

**Usage Example (`nexus.config.ts`)**
```typescript
import { defineNexusConfig } from 'vite-plugin-nexus';
import { nexusSecurity } from 'vite-plugin-nexus';

export default defineNexusConfig({
  plugins: [
    nexusSecurity({
      mode: 'block',
      allowVulnerable: {
        'pdfkit': {
          cve: 'CVE-2024-29415',
          reason: 'Build-time use only — not in client bundle. Patch releases 2026-06-15.',
          expires: '2026-07-01',
        },
      },
    }),
  ],
  security: { hardened: true },
});
```

### On Supply Chain MFA Detection

The question about detecting if package maintainers have MFA enabled is addressed explicitly:
npm's public registry API (`registry.npmjs.org`) does **not** expose individual MFA/2FA status.
npm's enforcement policy (required for packages >500 weekly downloads, since 2022) operates server-side.
What **is** detectable: single-maintainer packages, recent ownership changes, abandoned packages, rapid version publishing — all implemented in `supply-chain.ts`.
For your own packages, use `npm access list collaborators {pkg}` with appropriate token.

---

## [0.5.0] — 2026-04-03

### Added

**`@nexus_js/server` — Security by Default (5-Layer Protection)**

*Anti-CSRF & Anti-Replay (`packages/server/src/csrf.ts`)*
- `generateActionToken(sessionId, actionName, secret)` — HMAC-SHA256 signed, base64url-encoded token
- `validateActionToken(token, sessionId, actionName, secret)` — validates signature, session binding, action binding, expiry (15m TTL), and single-use (replay prevention via in-memory Set)
- `extractSessionId(request)` — extracts session from cookie patterns, falls back to IP+UA fingerprint
- `generateSessionId()` — cryptographically random session ID for cookie generation
- `ACTION_TOKEN_HEADER` constant (`x-nexus-action-token`)
- Constant-time comparison via `crypto.timingSafeEqual` to prevent timing attacks
- Automatic token pruning at 50K entries to prevent memory leaks

*Per-Action Rate Limiter (`packages/server/src/rate-limit.ts`)*
- `createRateLimiter(config)` — sliding window algorithm (more accurate than fixed window, no edge bursts)
- Supports window formats: `'30s'`, `'1m'`, `'5m'`, `'15m'`, `'1h'`, `'6h'`, `'24h'`
- Default key: IP address (supports `x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`)
- Override key: `keyFn: (req) => req.headers.get('x-user-id')` for user-level limits
- Returns RFC 6585 headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`
- `RateLimitError` class with `result` property for response shaping
- Global limiter registry via `registerLimiter` / `getLimiter`
- Automatic GC: timer clears expired entries every window interval

*`createAction` Security Integration (`packages/server/src/actions.ts`)*
- `createAction({ handler, rateLimit, csrf, schema, race, ... })` object-style API
- CSRF validation at action definition layer (set `csrf: false` for public endpoints)
- `rateLimit: { window: '1m', max: 3, keyFn?: fn }` — wired per-action at definition time
- `schema: z.object(...)` — Zod-compatible input validation before handler runs (prevents SQL injection via type coercion)
- Re-exports: `generateActionToken`, `validateActionToken`, `createRateLimiter`, `RateLimitError`, `parseWindow`

**`@nexus_js/serialize` — XSS Auto-Protection**
- All `string` values serialized for server→client transport are now HTML entity encoded
- Encodes: `&`, `<`, `>`, `"`, `'`, `` ` `` using Unicode escapes (`\u003c`, etc.)
- Survives re-serialization (JSON.stringify preserves Unicode escapes)
- New `sanitize(input)` export for explicit sanitization in island templates
- Zero performance overhead — single `.replace()` chain, no regex

**`packages/cli/src/audit.ts` — Nexus Security Auditor**
- `nexus audit` — comprehensive code analysis beyond `npm audit`:
  - **Secret Leaks**: hardcoded API keys, passwords, DB connection strings, `process.env` in client code
  - **XSS Vectors**: `innerHTML =`, `insertAdjacentHTML()`, `eval()` in island/client code
  - **Info Disclosure**: `console.log` with sensitive terms in server code
  - **Open Redirects**: unvalidated redirect targets from request params
  - **Security Headers**: missing CSP, HSTS, X-Frame-Options in nexus.config.ts
  - **Hardened Mode**: warning if not enabled
  - **Dependency CVEs**: wraps `npm audit --json` for critical/high/moderate summary
- `nexus audit --ci` — exits with code 1 if critical or high findings exist (CI pipeline ready)
- `nexus audit --json` — outputs findings as JSON for SAST tooling
- ANSI colored output: `CRITICAL | HIGH | MEDIUM | LOW | INFO` severity tags
- Per-category grouping with fix suggestions for every finding
- `.nx` file awareness: skips server frontmatter for `clientOnly` rules

**`examples/pokedex` — Security Demo**
- All HTML responses include: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-XSS-Protection: 0`
- Capture endpoint enforces rate limit: 3 captures/min per IP — returns 429 with `retry-after` header
- Dev Console **Security Panel**: `◆ Nexus Security Panel` group shows CSRF, rate limit, XSS, and headers status
- Hardened Mode badge visible in DevTools with `nexus audit --ci` call-to-action

### Answered

**On "Paranoid Mode" (detecting browser extensions):** Not implemented — fingerprinting extensions violates user privacy and is legally risky in GDPR/CCPA jurisdictions. Instead, Nexus uses "Hardened Mode" in `nexus.config.ts` which enforces security at the server layer where it actually works, without user surveillance.

---

## [0.4.0] — 2026-04-03

### Added

**`@nexus_js/router` — Multi-Tenant First-Class Support**
- `extractTenant(request, config)` — extracts tenant from subdomain, custom domain, or URL path
- `TenantConfig` type with `mode`, `baseDomain`, `pathPrefix`, `resolve`, and `fallback` options
- `scopeTenantKey(tenant, key)` — scopes Shield Cache keys per tenant, preventing cross-tenant data leaks
- `tenantHeaders(tenant)` — generates `x-nexus-tenant`, `x-nexus-tenant-domain` headers for CDN routing
- `tenantVaryHeader(mode)` — generates correct `Vary` header for CDN cache isolation per tenant
- All exports available via `@nexus_js/router`
- Supports `'subdomain'`, `'custom-domain'`, and `'path'` tenancy modes
- Optional async `resolve` function for loading tenant metadata (plan, name, logo) from your DB

**`@nexus_js/sync` — Local-First Sync Engine**
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

**`@nexus_js/ui` — Zero-Bundle CSS-Only Components**
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
- Battle capture now uses `@nexus_js/sync` pattern: IndexedDB write first, server sync second
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

**`@nexus_js/server` — Production-grade request pipeline**
- `RequestLogInfo` interface: structured per-request data (method, path, status, duration, cacheStrategy, isAction)
- `onRequest` hook in `NexusServerOptions` — lets the CLI (or any host) receive request events without coupling ANSI formatting to the server package
- `cacheStrategy` field populated from `x-nexus-cache-strategy` renderer header and exposed via the hook
- `isAction` flag to distinguish Server Action traffic in logs
- Detailed dev-mode error page in the browser with stack trace `<details>` block
- Detailed dev-mode error output in the terminal with stack trace (first 5 frames)
- `listen()` now returns `Promise<void>` — resolves when the port is bound; callers can `await` before printing the banner

### Changed

**`@nexus_js/cli` — Developer Experience overhaul (DX 2.0)**
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
- `@nexus_js/compiler` — `.nx` → JS transform with AOT CSS scoping (`@layer nexus.scoped`) and island preload scanner
- `@nexus_js/runtime` — Runes engine, island hydration, global state store, SPA navigation (Server-Driven DOM Morphing), cache, optimistic UI, `$sync` rune
- `@nexus_js/server` — HTTP server, SSR renderer with auto Edge-Cache headers, streaming SSR with Suspense, file-based error boundaries, Server Actions with AbortController and race condition strategies
- `@nexus_js/router` — File-based route manifest builder
- `@nexus_js/cli` — `nexus dev/build/start/studio/check/routes/analyze` + `create-nexus` scaffolder + Nexus Studio dashboard
- `@nexus_js/assets` — AVIF/WebP image optimization with srcset and blur placeholder; Google/local font optimization
- `@nexus_js/head` — `defineHead()` and `useHead()` for SEO metadata management
- `@nexus_js/middleware` — Web-standard middleware (CORS, rate limit, auth, geo, security headers) with Cloudflare/Vercel adapters
- `@nexus_js/serialize` — SuperJSON-like serializer for `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `URL`, `Uint8Array`, `undefined`, `NaN`, `Infinity`, `Error`
- `@nexus_js/types` — E2E type generation for routes, params, and Server Actions
- `@nexus_js/testing` — `renderSSR`, `mountIsland`, `createActionTestHarness` for Vitest/Playwright
- `@nexus_js/vite-plugin-nexus` — Vite plugin for HMR, CSS preprocessing, island manifest emission
- `@nexus_js/db` — BYOD thin provider adapter with Prisma, Drizzle, and libSQL/Turso adapters

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
