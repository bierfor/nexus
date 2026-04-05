# Production deployment and hardening

This document is **framework documentation** (for apps built with Nexus). The **nexusjs.dev** site is only the entry point that points users to this monorepo and npm packages.

It describes what **`nexus build`** produces, how **server actions** are secured in current releases (0.7.5+), and which **environment variables** matter in production. For the full version history, see **[CHANGELOG.md](https://github.com/bierfor/nexus/blob/main/CHANGELOG.md)** in the framework monorepo.

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

### When you see HTTP 412 (BUILD_MISMATCH)

JSON body looks like:

```json
{
  "error": "Application was updated. Please reload the page.",
  "status": 412,
  "code": "BUILD_MISMATCH"
}
```

**What it means:** the server has a **`.nexus/build-id.json`** (production build), but the request’s **`x-nexus-build-id`** header does not match. Usually the browser tab is still running **old JavaScript** from a previous deploy while the server already serves a **new** build.

**What to do:**

| Who | Action |
|-----|--------|
| **End user** | Reload the page (full refresh). **`callAction`** already triggers a reload on **412** when possible. |
| **App developer** | Ensure HTML and server share the same build: run **`nexus build`** once per deploy; deploy **`.nexus/`** (or your image) atomically; do not mix old HTML with a new server binary. |
| **CI/CD** | Set **`NEXUS_BUILD_ID`** to the **same** value in the **build** job (when generating `.nexus/build-id.json`) and in the **runtime** environment. Mismatched env between build and run causes permanent **412** until fixed. |
| **CDN / caching** | If HTML is cached too aggressively without **`Vary`**, a user might get HTML from build A while hitting an origin with build B. Nexus emits **`Vary: Accept, Accept-Encoding`** on public HTML; avoid stripping it or caching HTML across deploys without purge. |
| **Custom clients** | Any **`fetch` to `/_nexus/action/...`** must send **`x-nexus-build-id`** matching the current deployment (same string as in **`window.__NEXUS_BUILD_ID__`** on a fresh page load). |

**Temporary bypass (not recommended):** deleting **`.nexus/build-id.json`** on the server disables the check until the next build — only for debugging.

*(Español: **412 BUILD_MISMATCH** indica que la pestaña o el cliente usa un **build antiguo** frente a un servidor ya actualizado. Solución habitual: **recargar la página**; en CI, alinear **`NEXUS_BUILD_ID`** entre build y runtime; evitar mezclar HTML cacheado de un deploy con el servidor de otro.)*

## Server action security (0.7.5+)

### CSRF — dual tier

1. **Tier 1 (default):** the client must send a non-empty **`x-nexus-action`** header (browsers cannot set arbitrary headers on cross-site form posts). **`callAction`** sets it to the **action name**; other clients may use a marker such as **`1`**. This blocks classic CSRF without per-request token plumbing.
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

## Payments, idempotency, and plan limits (what Nexus provides)

Nexus does **not** ship Stripe, webhooks, or a billing “plan engine”. Those stay in **your app** and your PSP. The framework gives **building blocks** for safer money-related and entitlement-sensitive actions:

| Mechanism | Use for |
|-----------|---------|
| **`race: 'reject'`** on `registerAction` / `createAction` | **Checkout-style flows** — only one in-flight execution per action name; concurrent duplicate requests get **409** (double-submit / double-tab). |
| **`idempotent: true`** + header **`x-nexus-idempotency`** | **Safe retries** — same key within TTL returns the cached JSON result without running the handler again (pair with your PSP’s idempotency keys for real charges). |
| **`schema` (Zod, etc.)** | **Validate price IDs, amounts, currency, quantity** on the server; never trust raw client JSON alone. |
| **`rateLimit`** | Throttle abuse per IP or per-user (`keyFn`). |
| **CSRF tiers** | Default **`x-nexus-action`** header + optional HMAC token (see above). |
| **Production error masking** | Avoids leaking stack traces to the browser; use **`errorId`** in logs for support. |

The bundled **`callAction()`** helper in **`@nexus_js/serialize`** today sends **`x-nexus-build-id`** and the action header; for **idempotent** actions you typically **`fetch('/_nexus/action/…', { headers: { 'x-nexus-idempotency': crypto.randomUUID(), … } })`** yourself (or wrap `callAction` in your app).

### Validating “plans” or tiers

There is **no** `nexus.config` field like `plans: [...]`. Recommended pattern:

1. Resolve **tenant + subscription / plan row** in **`TenantConfig.resolve`** (from `@nexus_js/router`) or in **auth middleware**.
2. Attach entitlements to **`tenant.meta`** or **`ctx.locals`** (e.g. `{ plan: 'pro', seats: 10 }`).
3. At the start of each sensitive **`createAction`** / **`registerAction`** handler, **re-read or trust your server-side session + DB** and **return `ActionError` (403/402)** if the plan does not allow the operation.

That keeps billing source-of-truth in **your database** and the PSP, not in the framework.

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

## Server action errors (reference)

Responses from **`POST /_nexus/action/:name`** are JSON unless the server returns a **redirect** (e.g. `redirect()` inside an action). Below: **HTTP status**, optional **`code`**, typical **`error`** text, cause, and fix.

### Transport / routing

| Status | `code` | Meaning | What to do |
|--------|--------|---------|------------|
| **405** | — | Method not allowed (only **POST** is valid). | Call the endpoint with **`POST`**. |
| **404** | — | Path not under `/_nexus/action/` (plain text *Not Found*). | Fix the URL. |
| **404** | — | `Action "…" not found` | Action not **registered** / not loaded on this process. | Ensure **`registerAction`** / sidecars load at startup; name matches URL segment. |
| **400** | **`INVALID_ACTION_NAME`** | Malformed name in URL (`..`, illegal chars). | Only use names matching **`^[\w][\w.-]*$`**. |

### Security (Shield-lite, CSRF, origin)

| Status | `code` | Meaning | What to do |
|--------|--------|---------|------------|
| **403** | **`SHIELD_BLOCK`** | **`security.shieldLite`** is on and the action is **not** in the build manifest allowlist. | Run **`nexus build`** so **`shield-manifest.json`** includes the action, or disable Shield-lite for dev. |
| **403** | **`OPAQUE_ORIGIN`** | **`Origin: null`** (sandboxed iframe, `data:` URL, etc.). | Do not invoke actions from opaque contexts; open the app on a normal **https** origin. |
| **403** | **`MISSING_CSRF_HEADER`** | No **`x-nexus-action`** and no CSRF token (handler-level check). | Use **`fetch`** / **`callAction`** so the header is set; plain cross-site HTML forms will fail by design. |
| **403** | **`REPLAY_ATTACK`** / **`INVALID_CSRF_TOKEN`** | Tier-2 HMAC token invalid, expired, replayed, or clock skew. | Issue a new token; sync **`NEXUS_SECRET`** across instances; check server time. |
| **403** | **`MISSING_HEADER`** | Inner **`validateRequest`** (e.g. **`createAction`**) — missing **`x-nexus-action`**. | Same as missing CSRF header for typed clients. |
| **403** | **`CROSS_ORIGIN_BLOCKED`** | **`Origin` / `Referer`** does not match **`Host`**. | Call actions **same-origin**; fix reverse-proxy **`Host`** headers. |

### Build consistency

| Status | `code` | Meaning | What to do |
|--------|--------|---------|------------|
| **412** | **`BUILD_MISMATCH`** | **`x-nexus-build-id`** ≠ server’s **`.nexus/build-id.json`**. | See **[When you see HTTP 412 (BUILD_MISMATCH)](#when-you-see-http-412-build_mismatch)** above. |

### Limits & payload

| Status | `code` | Meaning | What to do |
|--------|--------|---------|------------|
| **429** | **`RATE_LIMITED`** | Per-action **rate limit** exceeded. | Wait **`Retry-After`** / **`resetAt`**; relax **`rateLimit`** if legitimate. |
| **413** | **`PAYLOAD_TOO_LARGE`** | Body over **`maxBodyBytes`** (default **10 MB**). | Send smaller JSON or raise **`ActionOptions.maxBodyBytes`** cautiously. |
| **400** | **`JSON_TOO_DEEP`** | JSON nesting **> 10** (pre-parse guard). | Reduce nesting depth. |
| **400** | **`JSON_TOO_COMPLEX`** | Too many **`:`** object keys (**> 1000**, pre-parse guard). | Shrink payload. |

### Concurrency & cancellation

| Status | `code` | Meaning | What to do |
|--------|--------|---------|------------|
| **409** | **`CONCURRENT_ACTION`** | **`race: 'reject'`** and another call is in flight. | Disable double-submit UI; expect one winner. |
| **409** | **`CANCELLED`** | **Timeout**, **client disconnect**, or **abort**. | Retry if appropriate; increase **`timeout`**. |
| **409** | **`ABORTED`** | **`race: 'cancel'`** superseded this run. | Normal for the *old* request when a newer one wins. |

### Validation & app errors

| Status | `code` | Meaning | What to do |
|--------|--------|---------|------------|
| **400** | **`VALIDATION_ERROR`** | **`schema.parse`** failed (**Zod**, etc.). | Fix client payload to match schema. |
| **4xx/5xx** | *(your code)* | **`throw new ActionError(msg, status, code)`** from your handler. | Implement your product logic. |
| **404** | — | **`notFound()`** in an action. | Expected when resource missing. |

### Unhandled exceptions

| Status | Field | Meaning | What to do |
|--------|-------|---------|------------|
| **500** | **`errorId`** (UUID) | **`NODE_ENV=production`** and **`NEXUS_EXPOSE_ERRORS`** is not **`true`**: message masked as *Internal Server Error*. | Search server logs for **`[Nexus Action <errorId>]`**. Set **`NEXUS_EXPOSE_ERRORS=true`** only on staging if you need the raw message in JSON. |
| **500** | — | Dev or exposed errors: **`error`** contains the exception message. | Fix the bug in your action. |

### Success & idempotency

- **200** — JSON body includes **`data`**, **`status`: 200**, optional **`duration`**, optional **`idempotencyKey`** echo.
- If **`idempotent: true`** and the same **`x-nexus-idempotency`** header repeats within TTL, the server may return **200** with the **cached** result without re-running the handler.

### Redirects

If the action calls **`redirect()`**, the response is an HTTP redirect (**3xx**) with **`Location`** — not a JSON error body.

## Publishing the framework (maintainers)

See **[PUBLISHING.md](https://github.com/bierfor/nexus/blob/main/docs/PUBLISHING.md)**. Prefer **`pnpm release:safe`** (build + test + publish) over **`pnpm release`** when you want tests to gate the release.

## Further reading

- **nexusjs.dev** — deployed from **[github.com/bierfor/nexusjs-site](https://github.com/bierfor/nexusjs-site)**; this file is served at **[nexusjs.dev/docs/PRODUCTION.md](https://nexusjs.dev/docs/PRODUCTION.md)**. Landing source in the monorepo: **[docs/index.html](https://github.com/bierfor/nexus/blob/main/docs/index.html)**.
- Changelog: **[CHANGELOG.md](https://github.com/bierfor/nexus/blob/main/CHANGELOG.md)**.
- Server action errors (412, CSRF, rate limits, etc.): **[Server action errors (reference)](#server-action-errors-reference)** above.
