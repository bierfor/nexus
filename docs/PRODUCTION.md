# Production deployment and hardening

This document describes what **`nexus build`** produces, how **server actions** are secured in current releases (0.7.5+), and which **environment variables** matter in production. For the full version history, see [`CHANGELOG.md`](../CHANGELOG.md) in the repository root.

## Build output (`.nexus/`)

After **`nexus build`** from your app root:

| Path | Purpose |
|------|---------|
| `.nexus/output/` | Compiled client assets and route bundles for production |
| `.nexus/build-id.json` | `{ buildId, generatedAt }` — stable identifier for this build (see below) |
| `.nexus/lib/**/*.js` | Transpiled copies of `src/lib/**/*.ts` (`compileLib`) so the server resolves `$lib` to plain JS at runtime |

Root **`+layout.nx`** and root **`+page.nx`** no longer collide: layouts emit `index._layout.js` (and analogous `*._layout.js`); pages emit `segment.js`.

## Build ID contract (0.8.0+)

- **`nexus build`** writes **`.nexus/build-id.json`**. If **`NEXUS_BUILD_ID`** is set (recommended in CI/CD), that string is used; otherwise a short digest is generated from timestamp + randomness.
- The server loads this file at startup via **`loadAndCacheNexusBuildId(appRoot)`**.
- When a build ID exists, **`handleActionRequest`** requires the request header **`x-nexus-build-id`** to match. A mismatch returns **412** with code **`BUILD_MISMATCH`**.
- The HTML renderer injects **`window.__NEXUS_BUILD_ID__`** in the document `<head>` (`RenderOptions.buildId`).
- **`callAction`** (in **`@nexus_js/serialize`**) sends **`x-nexus-build-id`** when the global is set; on **412** it schedules **`location.reload()`** so stale tabs pick up the new deployment.

**CI tip:** set **`NEXUS_BUILD_ID`** to your git commit SHA (or image digest) in the same job that runs `nexus build`, and pass the same value to the runtime environment so HTML and server agree.

## Server action security (0.7.5+)

### CSRF — dual tier

1. **Tier 1 (default):** the client must send the custom header **`x-nexus-action: 1`**. Untyped cross-origin form posts cannot set arbitrary headers, which blocks classic CSRF without per-request token plumbing.
2. **Tier 2 (when `x-nexus-action-token` is present):** the server validates the **HMAC-SHA256** token (**session-bound**, **single-use**, **~15 minute** lifetime, **`USED_TOKENS`** map with TTL-based eviction). Tokens more than **5 seconds** in the future vs server clock are rejected (multi-node / crafted `iat` guard).

**Opaque origins:** requests with **`Origin: null`** (e.g. sandboxed iframes, `data:` URLs) are rejected before CSRF tiers (**403 `OPAQUE_ORIGIN`**).

**Origin / Referer:** inner validation used by action wrappers also checks **`Origin`** / **`Referer`** and rejects cross-origin requests that carry a foreign origin.

### Rate limiting

Per-action limiters are retrieved via a **registry** (`getLimiter(actionName)`) so sliding-window state **persists across requests**. Registering `rateLimit` on `registerAction` / `createAction` is what the handler uses.

### Request shape

- **Action name** in `/_nexus/action/<name>` must match **`^[\w][\w.-]*$`** (blocks path-style probing).
- **Body size:** default cap **10 MB** (`MAX_ACTION_BODY_BYTES`); override per action with **`ActionOptions.maxBodyBytes`**.
- **JSON bodies:** before `JSON.parse`, a linear scan enforces **max nesting depth 10** and **max 1000 object keys** (mitigates CPU abuse).

### HTML caching

Public and SWR HTML responses include **`Vary: Accept, Accept-Encoding`** so shared caches do not serve wrong variants.

### Dev-only endpoints

**`/_nexus/dev/hot`** and **`/_nexus/dev/vault`** require **`Origin`** to be a **loopback** host (`localhost`, `127.x.x.x`, `::1`).

## Environment variables

| Variable | Role |
|----------|------|
| **`NEXUS_SECRET`** | Signing key for CSRF / action tokens. In production (`dev: false`), startup logs a **`[Nexus Security]`** warning if unset — default secrets allow forged tokens. |
| **`NEXUS_BUILD_ID`** | Optional; if set at **build** time, written into `.nexus/build-id.json` instead of a random id. |
| **`NEXUS_EXPOSE_ERRORS`** | If **`true`**, unhandled action errors can return verbose messages. If unset in **`NODE_ENV=production`**, responses are **masked** with a generic message and a unique **`errorId`** (details only in server logs). |

## SSRF-safe URL helpers

From **`@nexus_js/server`**:

- **`isInternalUrl(url)`** — `true` for non-public ranges (RFC1918, localhost, link-local, metadata, etc.).
- **`isSafeUrl(url)`** — `true` only for **`http:`** / **`https:`** URLs that are **not** internal (for wrapping `fetch` to user-supplied URLs).

## Publishing the framework (maintainers)

See **[`PUBLISHING.md`](./PUBLISHING.md)**. Prefer **`pnpm release:safe`** (build + test + publish) over **`pnpm release`** when you want tests to gate the release.

## Further reading

- Site overview: [`docs/index.html`](./index.html) (sections **Production hardening**, **Security by Default**, **Changelog**).
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md).
