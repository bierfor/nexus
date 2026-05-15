# Changelog

All notable changes to Nexus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.9.21] — 2026-05-15

### Fixed — CSS / Tailwind Support in Dev Mode 🎨

Nexus now correctly serves global stylesheets (including Tailwind / PostCSS) during server-side rendering in development, eliminating the "lost styles on refresh" bug.

- **New dev endpoint `/_nexus/global.css`** (`packages/server`):
  - Auto-discovers global CSS entries: `src/app.css`, `src/global.css`, `src/index.css`, `src/styles.css`
  - Optional PostCSS processing when `postcss` is installed — loads `postcss.config.{mjs,cjs,js}` automatically
  - Tailwind CSS, Autoprefixer, and any PostCSS plugin work out of the box
  - ETag + `304 Not Modified` caching to avoid unnecessary rebuilds on hard refresh
  - Cache is warmed before browser reload and busted on every file change

- **SSR injection** (`packages/server`):
  - In dev mode, the server-rendered HTML now includes `<link rel="stylesheet" href="/_nexus/global.css">` before the scoped `/_nexus/styles.css`
  - Duplicate detection: if the user already declares the stylesheet in a layout, Nexus skips injecting it again
  - `renderOpts.assets.styles` is re-evaluated on `server.reload()` so adding/removing a global CSS file does not require restarting `nexus dev`

- **Config override** (`packages/cli`):
  - New `nexus.config.ts` option: `css: { entry: 'src/my-styles.css' }`
  - Overrides auto-discovery when the project uses a non-conventional filename or path

- **Performance** (`packages/cli`):
  - File-watcher debounce reduced from **120 ms → 50 ms** so CSS cache invalidation and rebuilds happen faster after saving

### Security

- **Path-traversal guard** on custom `css.entry`: if a config value escapes the app root (e.g. `../../../etc/passwd`), the entry is ignored with a warning

---

## [0.9.3] — 2026-04-08

### Added — GraphQL Integration (`@nexus_js/graphql`) 🆕

A complete, security-first GraphQL adapter that integrates seamlessly with Nexus's server pipeline:

- **`createGraphQLHandler({ schema, shield, mask, cors, ... })`** — Returns a Web-standard `(Request, NexusContext) => Promise<Response>` handler compatible with Nexus mounts. No Express dependency.
- **Shield: Complexity & Depth Analysis** — `analyseComplexity()` scans the GraphQL AST before execution to prevent expensive queries:
  - `maxCost` (default: 1000) — Total query cost limit
  - `maxDepth` (default: 12) — Maximum nesting level
  - `listMultiplier` (default: 10) — Cost multiplier for list fields
  - `fieldCosts` — Per-field cost overrides (e.g., `{ 'Query.analytics': 50 }`)
  - `allowIntrospection: false` — Blocks `__schema` / `__type` in production
- **Field Masking** — `maskResult()` redacts sensitive fields after execution:
  - Static replacement: `{ 'User.passwordHash': null, 'PaymentCard.cvv': 'REDACTED' }`
  - Role-based: `allowWhen((ctx) => ctx.user?.role === 'admin')`
  - Conditional: `redactUnless((ctx, val) => ctx.user?.id === ctx.vars?.userId, '***@***.***')`
- **JWT with Vault Key Rotation** — `createJwtService(nexusVault, opts)`:
  - HS256 signing/verification using `node:crypto`
  - Vault-backed secret rotation with hot-reload (no server restart)
  - Grace period (default: 5min) for old tokens during rotation
  - `timingSafeEqual` comparison to prevent timing attacks
- **DataLoader (N+1 Prevention)** — `createBatchLoader(batchFn)`:
  - Batches requests within a microtask tick
  - Deduplicates keys automatically
  - Ensures values returned in same order as requested
  - Per-request loader registry pattern
- **CORS Handling** — Built into the handler:
  - OPTIONS preflight (204 with `Access-Control-*` headers)
  - Origin validation (array, wildcard, or predicate function)
  - Rejects `credentials: true` with `origins: '*'` (browser will reject)
  - No conflict with Nexus security headers (applied separately by server)
- **GraphiQL Integration** — Serves interactive GraphiQL IDE in dev mode on GET requests with `Accept: text/html`
- **Rate Limiting** — Per-IP sliding window rate limiting built into handler
- **Error Handling** — Strips stack traces in production; returns safe error messages

**Exports:** `createGraphQLHandler`, `analyseComplexity`, `maskResult`, `allowWhen`, `redactUnless`, `createJwtService`, `signJwt`, `verifyJwt`, `BatchLoader`, `createBatchLoader`, `createLoaderRegistry`

### Added — Legacy Bridge (`@nexus_js/graphql`, `@nexus_js/server`, `@nexus_js/security`) 🆕

Gradual migration tools for wrapping existing backends without downtime:

**Remote GraphQL Proxy:**
- **`createRemoteExecutor(opts)`** — Proxy to external GraphQL APIs with Nexus Shield applied on top
  - Forward requests to legacy backends (e.g., `https://old-api.company.com/graphql`)
  - Add rate limiting, complexity analysis, and field masking without modifying the legacy code
  - Optional request batching, retry logic, timeout control
  - Transform variables/results for format adaptation
- **`createRemoteExecutorWithSchema(opts)`** — Fetch remote schema via introspection for stitching

**Schema Stitching:**
- **`stitchSchemas({ subschemas, typeMerging, resolvers })`** — Merge multiple GraphQL schemas into one unified API
  - Combine remote schemas (legacy) with local Nexus schemas (new features)
  - Type merging: add new fields to old types without touching legacy codebase
  - Custom resolvers: add Shield protection to legacy fields
- **`createGatewayResolver({ services, routing })`** — Route requests to different microservices

**HTTP Fallback Proxy:**
- **`fallbackProxy` option in `createNexusServer`** — Forward unmatched routes to legacy backend
  - Nexus handles new routes (`/dashboard`, `/api/v2`, etc.)
  - Unknown paths proxy to old server (e.g., `http://localhost:8080`)
  - Preserves headers, cookies, request body
  - Returns 502 if legacy backend unavailable

**Express/Connect Wrapper:**
- **`wrapExpressMiddleware(middleware)`** — Convert Express middleware to Nexus Server Actions
- **`wrapExpressHandler(handler)`** — Wrap Express route handlers
  - Mock `req.body`, `req.params`, `res.json()`, `next()`
  - Existing business logic runs unchanged
  - Automatically protected by Nexus CSRF, rate limiting, Shield

**Vault Import:**
- **`importToVault(opts)`** — Import secrets from .env, JSON, AWS/GCP Secrets Manager
  - Filter by regex: `/^DB_|^API_KEY/`
  - Prefix for namespacing: `LEGACY_DB_HOST` → `LEGACY_DB_HOST`
  - Overwrite control for existing keys
- **`autoImportEnv({ root, prefix, filter })`** — Auto-import `.env` file at startup
  - Enable hot-reload rotation for imported secrets
  - Delete old `.env` once migration completes

**Vault Enhancement:**
- **`NexusVault.set(key, value)`** — Public method for programmatic secret updates (used by `importToVault`)

### Added — Deployment Infrastructure 🆕

Production-ready deployment tooling for VPS, Docker, and CI/CD:

**Docker Support:**
- Multi-stage `Dockerfile` (builder + runner) optimized for minimal image size
- Non-root user for security (`nexus:nexus`)
- Health check endpoint integration
- `.dockerignore` for clean builds

**Docker Compose:**
- Full stack: Nexus + PostgreSQL + Redis + Nginx
- Persistent volumes for database and cache
- Health checks for all services
- Isolated network

**Deployment Scripts:**
- `scripts/deploy.sh` — Automated deployment with health checks and rollback
- `scripts/rollback.sh` — One-command rollback to previous version
- `scripts/migrate.sh` — Database migration support (Prisma or raw SQL)
- Environment validation
- Build ID tracking with git SHA

**CI/CD:**
- GitHub Actions workflow: lint → test → build → docker → deploy
- Docker Buildx multi-platform support
- SSH deployment to production
- Automatic rollback on health check failure
- pnpm cache for faster builds

**Environment Management:**
- Comprehensive `.env.example` with all configuration options documented
- Support for multiple environments (`.env.production`, `.env.staging`)

### Added — NexusMountDef (`@nexus_js/server`)

- **`mounts` option in `NexusServerOptions`** — Mount custom HTTP handlers before static files and SSR
  - Signature: `(Request, NexusContext) => Promise<Response>`
  - Compatible with `@nexus_js/graphql` handlers
  - Evaluated in order; first match wins
  - Example: `mounts: [{ path: '/graphql', handler: gqlHandler }]`

### Fixed — Package Exports

- **`@nexus_js/graphql`** — All new types and functions correctly exported from `src/index.ts`
- **`@nexus_js/server`** — `wrapExpressMiddleware`, `wrapExpressHandler`, `NexusMountDef` exported
- **`@nexus_js/security`** — `importToVault`, `autoImportEnv` exported

---

## [0.9.0] — 2026-04-07

### Added — Smart Pre-fetching (`@nexus_js/runtime`)

- **`data-nx-prefetch="load"`** — new mode that prefetches immediately on `DOMContentLoaded`. Ideal for critical next-step links.
- **`data-nx-prefetch="visible"`** — extended `rootMargin` from 100px to 200px for earlier prefetch trigger.
- **`MutationObserver`** — dynamically added `[data-nx-prefetch="visible"]` links are automatically observed after the initial page paint (e.g. after SPA navigation updates the DOM).
- **`shouldSkipPrefetch()`** — unified guard applied consistently to `hover`, `visible`, `load`, and click interception. Now correctly skips `//`, `javascript:`, and `data-nx-external` in all code paths.

### Added — Real LQIP Image Placeholders (`@nexus_js/assets`)

- **`generateBlurDataURL(buffer: Buffer): Promise<string>`** — uses Sharp to generate a 10×10 blurred JPEG encoded as an inline base64 data URI (~200–400 bytes). Call server-side to embed a real thumbnail in the HTML without an extra network round-trip.
- **`blurFromFile(absolutePath: string): Promise<string>`** — convenience wrapper that reads the file then calls `generateBlurDataURL`.
- **`ImageProps.blurDataURL?: string`** — pass the precomputed data URI; `renderImage` inlines it as `background-image` on the `<picture>` container.
- `<img>` starts at `opacity:0` and fades to `opacity:1` via a CSS transition on `onload`, with `data-nx-blur` removed atomically.
- **`/_nexus/image?blur=1`** — new endpoint that returns a cached LQIP JPEG for any local or remote image.

### Added — Type-safe Router (`@nexus_js/runtime/router`)

- **New entry point `@nexus_js/runtime/router`** — real module (not types-only) that re-exports `navigate`, `prefetch`, and `NavigateOptions` from the navigation module.
- `packages/runtime/package.json` now exposes `"./router"` and `"./prefetch-ai"` under `exports`.
- Generated `nexus-types.d.ts` augments `@nexus_js/runtime/router` with:
  - `navigate<R extends keyof RouteParams>(route, params, opts?): Promise<void>` (was incorrectly typed as `void`)
  - `prefetch<R extends keyof RouteParams>(route): void`
  - `NavigateOptions` interface

### Fixed — Streaming SSR (`@nexus_js/server`)

- **Fallback HTML now rendered on first paint** — `__nx_init_fallbacks()` in the bootstrap script reads `data-nx-fallback` from each `<template>` hole and inserts the skeleton/spinner HTML immediately. `__nx_fill()` removes it atomically when the real content arrives.
- **Functional `errorFallback`** — `StreamingBoundary.errorFallback` now correctly accepts `string | ((err: unknown) => string)`. The function form was previously silently dropped by `createSuspenseBoundary`.
- **`</script>` injection** — `buildFatalErrorChunk` and the pretextWire script now escape `<` → `\u003c` and `>` → `\u003e` inside `JSON.stringify` payloads.
- Removed dead `__nx_fill_error` from the bootstrap script (used `innerHTML` with a raw JS string — XSS risk). Error boundaries now use the same safe `<template>` mechanism as successful fills.

### Added — Security Stack (`@nexus_js/server`, `@nexus_js/vite-plugin-nexus`)

- **Tainted modules** — `vite-plugin-nexus` blocks client-side imports of `*.server.ts` and `lib/server/**` files at build time.
- **`NEXUS_PUBLIC_`** prefix enforced; `envGuardPlugin` warns at build time on accidental private env access in client code.
- **`NEXUS_SECRET`** required ≥ 32 chars in production; server refuses to start without it.
- **CSRF** — HMAC-signed single-use tokens, strict `Origin`/`Referer` validation (protocol + hostname + port), hardened anonymous fingerprint using `NEXUS_SECRET`.
- **Action URL signing** — HMAC-signed `?__sig=` parameter; verified server-side with `timingSafeEqual`.
- **Schema validation** — `createAction` uses `schema.safeParse()` and returns structured `fieldErrors` in `ActionError`.
- **CSP nonce** — per-request random nonce injected into all inline `<script>` tags.
- **`metadata.ts`** — new `defineMetadata()` helper with automatic XSS-safe escaping for `<meta>` tag values.
- **Progressive enhancement** — Server Actions respond to native HTML form `POST` with HTTP 303 redirect (PRG pattern).
- **Rate limiter** — single shared GC timer across all limiter instances (was O(n) `setInterval` leak).
- **Path traversal** — `serveStatic` uses `resolve()` + `startsWith(root + sep)` guard.
- **Safe JSON serialization** — island props use `base64url` (full Unicode); all `<script>` payloads escape `<`, `>`, `&`, `\u2028`, `\u2029`.

### Added — VS Code Extension (`extensions/nexus-vscode`)

- Full syntax highlighting for `.nx` files via TextMate grammar (embedded HTML, CSS, TypeScript).
- Language configuration: bracket pairs, comment toggling, auto-closing.
- Snippet library for islands, server frontmatter, actions, `$state`, `$derived`, `$effect`.
- Commands + keybindings: wrap selection in `client:visible` / `client:load` / `client:idle` island divs.

---

## [0.8.0] — 2026-04-06

### Added — build consistency

**`@nexus_js/cli` — `.nexus/build-id.json` on every `nexus build`**

- Writes `{ buildId, generatedAt }` before compiling routes. If `NEXUS_BUILD_ID` is set (CI/CD), that value is used; otherwise a short SHA-256 digest from timestamp + random bytes.
- Ensures the same identifier is available to the server and to HTML injection (no runtime-only env drift).

**`@nexus_js/server` — build ID contract for server actions**

- On startup, reads and caches `.nexus/build-id.json` via `loadAndCacheNexusBuildId(appRoot)`.
- When a build ID is present, `handleActionRequest` requires `x-nexus-build-id` to match; otherwise responds with **412** and code `BUILD_MISMATCH`.
- `RenderOptions.buildId` injects `window.__NEXUS_BUILD_ID__` in the document `<head>`.

**`@nexus_js/serialize` — `callAction` sends build ID and handles 412**

- Adds `x-nexus-build-id` when `window.__NEXUS_BUILD_ID__` is set.
- On **412**, queues `location.reload()` so stale tabs pick up the new bundle.

Exports: `loadAndCacheNexusBuildId`, `getExpectedNexusBuildId` from `@nexus_js/server`.

### Security

**`@nexus_js/server/csrf` — clock skew / future-token guard**

- `validateActionToken` rejects tokens whose issued time is more than **5 seconds** ahead of the server clock (multi-node drift and crafted far-future `iat`).

**`@nexus_js/server` — JSON complexity guard (CPU DoS)**

- Before parsing JSON action bodies, a linear scan enforces **max nesting depth 10** and **max 1000 object keys** (colon count in object property positions).

**`@nexus_js/server` — `isSafeUrl(url)`**

- Returns `true` only for `http:` / `https:` URLs that are **not** internal (RFC1918, localhost, link-local, metadata ranges, etc.). Complements `isInternalUrl` for SSRF-safe `fetch` wrappers.

**`@nexus_js/server` — production error masking for unhandled action failures**

- When `NODE_ENV === 'production'` and `NEXUS_EXPOSE_ERRORS` is not `true`, non-`ActionError` exceptions return a generic message, a unique **`errorId`** (UUID) in the JSON body, and full details only in server logs (`[Nexus Action <errorId>] …`). Set `NEXUS_EXPOSE_ERRORS=true` to restore verbose responses (e.g. staging).

### Fixed

**`@nexus_js/cli` + `@nexus_js/server` — root layout and root page both wrote `index.js`**

- `+layout.nx` and `+page.nx` at `/` shared the same output path; the page overwrote the layout. Layouts now emit `{segment}._layout.js` (e.g. `index._layout.js`); pages keep `{segment}.js`. `loadRouteModule` accepts `isLayout` so production resolves the correct file.

---

## [0.7.5] — 2026-04-05

### Security

**`@nexus_js/server` — CSRF protection was entirely bypassed for sidecar-registered actions**

- `handleActionRequest` previously required **only** `x-nexus-action-token` (HMAC token) for CSRF validation, but the compiler always emitted `{ csrf: false }` in every generated sidecar, making the check unreachable. All actions had zero CSRF protection.
- New **dual-tier CSRF system**:
  - **Tier 1 (default):** Requires `x-nexus-action: 1` custom header. Browsers cannot send arbitrary custom headers cross-origin without a CORS preflight the server will reject — this blocks all form-based CSRF attacks without needing server-side token generation.
  - **Tier 2 (opt-in / future):** When `x-nexus-action-token` is also present, validates the full HMAC-SHA256 signed, single-use, session-bound token via `validateActionToken`. Provides replay-attack prevention on top of Tier 1.
- `validateRequest` (inner check used by `createAction` wrappers) now also validates `Origin` / `Referer` headers and rejects cross-origin requests that carry an explicit foreign origin.

**`@nexus_js/compiler` — `{ csrf: false }` removed from all generated sidecars**

- `generateActionsModule` no longer emits `{ csrf: false }` in `registerAction(...)` calls. Actions now inherit the default options, enabling the CSRF check in `handleActionRequest`.

**`@nexus_js/server` — rate limiting was completely non-functional in `handleActionRequest`**

- `handleActionRequest` was calling `createRateLimiter(opts.rateLimit)` on every request, creating a fresh in-memory limiter with an empty sliding-window state. Every check returned `allowed: true`, making the rate-limit effectively a no-op.
- Fixed: the handler now calls `getLimiter(actionName)` to retrieve the **pre-registered** limiter instance (the one created at startup in `registerAction`) whose hit-log persists across requests.

**`@nexus_js/server/csrf` — `USED_TOKENS` could grow unbounded and evict still-valid tokens**

- `pruneUsedTokens` previously evicted tokens by insertion-order count (oldest 10% when > 50 000 entries). This could remove tokens that were consumed less than 15 minutes ago, allowing replay attacks during high-traffic bursts.
- Changed `USED_TOKENS` from `Set<string>` → `Map<string, expiresAtMs>`. `pruneUsedTokens` now evicts only tokens past their TTL — safe to forget since they'd fail the expiry check anyway.

**`@nexus_js/server` — `NEXUS_SECRET` not set produces no warning in production**

- `createNexusServer().listen()` now logs a visible `[Nexus Security]` warning in production (`dev: false`) when `NEXUS_SECRET` is not set. Using the default secret allows forged CSRF tokens.

**`@nexus_js/server` — opaque `Origin: null` could bypass the CSRF custom-header check**

- Sandboxed iframes and `data:` URIs send the literal string `"null"` as the `Origin` header. This value passed the Tier 1 custom-header check. `handleActionRequest` now rejects any request with `Origin: null` before reaching the CSRF tiers (`403 OPAQUE_ORIGIN`).

**`@nexus_js/server` — action name not validated, allowing path-traversal probing**

- The action name from `/_nexus/action/<name>` was passed directly to the registry without format checks. Added a strict allowlist regex (`^[\w][\w.-]*$`) that rejects `..` and unsafe characters before any registry lookup.

**`@nexus_js/server` — server actions accepted unbounded request bodies**

- `deserializeInput` read the entire body with no size limit, making the endpoint vulnerable to memory-exhaustion via oversized payloads. Added `MAX_ACTION_BODY_BYTES` (10 MB default), checked via `Content-Length` before reading and after body materialisation for chunked transfers. Configurable per-action via `ActionOptions.maxBodyBytes`.

**`@nexus_js/server/renderer` — public responses missing `Vary` header**

- Public and SWR-cached HTML responses did not include a `Vary` header. Shared proxies and CDNs could serve incorrect cached variants. All non-private responses now emit `Vary: Accept, Accept-Encoding`.

**`@nexus_js/server` — dev-only endpoints accessible from external network origins**

- `/_nexus/dev/hot` (HMR SSE) and `/_nexus/dev/vault` (secret hot-reload) had no origin restriction. Both endpoints now require the `Origin` header to be a loopback address (`localhost`, `127.x.x.x`, `::1`); opaque and external origins are rejected.

### Fixed — production deployment (Node-only / Docker / Hetzner)

**`@nexus_js/compiler` — `$lib` resolves to `.ts` in production builds**

- `resolveDollarLibFilePath` now checks `.nexus/lib/*.js` (pre-compiled output) **first** in production, then falls back to a JS-first extension order. Previously it always preferred `.ts`, causing `Unknown file extension ".ts"` crashes at runtime.
- New `compileLib(appRoot)` utility transpiles `src/lib/**/*.ts` → `.nexus/lib/**/*.js` using TypeScript's `transpileModule` (no type-check, pure syntax pass — fast). Exported from `@nexus_js/compiler`.

**`@nexus_js/compiler` — sidecar import broken for nested routes**

- `actionsServerImportFilename` now returns `basename(segment).js` for production instead of the full path segment (`auth/login.js`). The sidecar is always adjacent to the server module, so the relative import must reference only the filename — e.g. `./login.js`, not `./auth/login.js`.

**`@nexus_js/compiler` + `@nexus_js/server` — sidecar missing `$lib` imports**

- `generateServerModule` now exports each `"use server"` action as `export async function __nexus_action_<name>(…)`, keeping the `$lib` imports in scope.
- `generateActionsModule` (the sidecar) now imports **all** action handlers from the co-located server module (`__nexus_action_*` for inline actions, original name for `createAction`), then calls `registerAction`. No more duplicated bodies, no more missing `$lib` symbols.
- Removed the hardcoded `actionsImportPreamble` hacks (`appendMessage`, `validateFlowPayload`, `appendVisit`) from `load-module.ts` and `bin.ts` — superseded by the correct export/import mechanism.

**`@nexus_js/cli` — `nexus build` compiles `src/lib`**

- `runBuild` calls `compileLib(root)` before writing route server modules so the `file://` URLs embedded in those modules resolve to plain JS at `nexus start` time.

**`@nexus_js/vite-plugin-nexus` — `dev: true` hardcoded in production builds**

- `configResolved` now sets `isDevMode = config.command === 'serve'`. The `transform` hook passes the correct `dev` flag to the compiler; previously production Vite builds always compiled with dev code-paths (timestamp cache-busting, TS-first `$lib` resolution).

---

## [0.7.4] — 2026-04-05

### Added

**`@nexus_js/cli` & toolchain**

- **`load-app-config`** via **jiti** for reliable `nexus.config` loading in dev and build.
- **`failOnIslandSecurity`** on production build — failed island security checks stop the build.
- **`last-build-security.json`** snapshot for Studio / reporting.

**`@nexus_js/server` — DevRadar & dev ergonomics**

- **DevRadar** and dev hot-path instrumentation; inspector / handler splits for clearer debugging.

**`@nexus_js/compiler`**

- **Client island security scan** integrated with the hardened build pipeline.

**`@nexus_js/serialize`**

- **Escape / serialization hardening** for safer cross-boundary payloads.

**Nexus Studio**

- Security report reads the **last build security snapshot**; **observability** defaults tuned for local development.

### Fixed

**`@nexus_js/compiler` — `.nx` control flow for SSR and islands**

- **`{#if …}`, `{:else if …}`, `{#each …}` headers** — Headers are parsed with **`findBlockTagExprEnd`**, which tracks nested `()`, `[]`, and `{}`, so expressions such as `.filter((x) => …)` or objects with `}` no longer truncate the condition, leak `{#if` into generated JavaScript as `${#if`, or trigger invalid private-field / syntax errors in SSR bundles.
- **Nested `{#each}`** — When resolving `{/each}`, inner `{#each` / `{/each}` pairs are skipped so the outer block closes at the correct boundary.
- **SSR pipeline** (`templateToSSR`) — **`expandIfBlocks`** runs before **`expandEachBlocks`**, which runs before **`interpolateExpressionsForSSR`**, so server-rendered HTML follows the same control-flow structure as the source template.
- **Client islands** — The same if/each expansion ordering applies before `{expression}` interpolation so hydrated islands do not mis-handle or strip control-flow output.

### Changed

- All **`@nexus_js/*`** package versions aligned to **0.7.4**; the Vite plugin is published as **`@nexus_js/vite-plugin-nexus`** (replaces the removed unscoped **`vite-plugin-nexus`** name on npm).
- Sample **`news`** app (when present in the workspace): SEO helpers, i18n/auth tweaks, **`failOnIslandSecurity`** and observability options in **`nexus.config`**.

**Documentation & public monorepo (2026-04-05)**

- Root **README** streamlined (overview, quick start, monorepo map, links to [nexusjs.dev](https://nexusjs.dev) and in-repo docs).
- **`docs/README.md`** — Index of contributor docs (`PRETEXT`, `ISLANDS`, `PUBLISHING`, `REPOSITORY`).
- **`docs/REPOSITORY.md`** — How to publish a clean GitHub remote and what belongs in the public monorepo.
- **`docs/assets/nexus-logo.svg`** — Logo used in the README.
- **`CONTRIBUTING.md`** — Section linking to `docs/REPOSITORY.md`; discussions URL described generically for any fork/org.
- **`docs/PUBLISHING.md`** — Source URL wording aligned with maintainer-owned GitHub repos.
- **`docs/ISLANDS.md`** — i18n / islands examples reference the **full** `create-nexus` template instead of a removed in-tree app path.
- **`pnpm-workspace.yaml`** / root **`package.json`** workspaces — Only **`packages/*`** and **`examples/*`**; private product trees **gitignored** at the repo root (`fin-sh/`, `mongo/`, `news/`, `my-nexus-app/`).
- Removed from version control: root **`vercel.json`**, **`Dockerfile.news`**, **`sveltro-next.html`**.
- **`packages/cli/scripts/sync-scaffold-nx.mjs`** — Clear error when **`my-nexus-app/`** is missing (local-only scaffold source).

---

## [0.7.3] — 2026-04-04

### Added

**Reference stack in the workspace (sample / integration — not published as `@nexus_js/*`)**

- **`mongo/`** — Express **GraphQL** API with **Prisma** + MongoDB, auth helpers, Cloudinary media hooks, flash-news HTTP integration, deploy notes (`DEPLOY.md`, Docker, Vercel-oriented docs).
- **`mongo/frontend/`** — **Next.js** editorial frontend wired to the same API (admin, articles, SEO surfaces).
- **`news/`** Nexus app — **admin CMS** (articles, heroes, flashes), GraphQL client utilities, **media uploads**, **`/dev`** QA checklist and **`test:smoke`** script.

*These trees were later removed from the public GitHub monorepo and are intended to stay local or live in separate repositories; they do not ship on npm as framework packages.*

---

## [0.7.2] — 2026-04-04

### Added

**Contributor documentation**

- **`docs/ISLANDS.md`** — Islands architecture, `client:*` directives, component layout.
- **`docs/PRETEXT.md`** — Route **`// nexus:pretext`**, merged **`pretext`**, and **`$pretext()`** on the client.
- **`docs/PUBLISHING.md`** — Expanded maintainer guide for **`pnpm release`** and version alignment.
- **`docs/index.html`** — Static multilingual landing refresh.

### Changed

- Root **README** updates (links and onboarding).
- **`create-nexus`** / **`my-nexus-app`** scaffold alignment for the full starter shape.
- **`.npmrc`** and root **`.gitignore`** tweaks for the expanded workspace.

---

## [0.7.1] — 2026-04-04

### Changed

**`@nexus_js/cli` & runtime DX**

- **Env reload hints** during dev when configuration changes.
- **Dev error pages** with clearer context.
- **Prefetch / navigation** improvements for smoother route transitions.

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
import { defineNexusConfig } from '@nexus_js/vite-plugin-nexus';
import { nexusSecurity } from '@nexus_js/vite-plugin-nexus';

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
