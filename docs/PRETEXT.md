# Pretext (pre-context)

Pretext is server-only data that runs **before** layout and page `render()`, in parallel across the route chain. Results are shallow-merged into `ctx.pretext`, serialized into the HTML, and read on the client as **`$pretext()`** so islands avoid a second round-trip.

## Authoring

In a `.nx` file frontmatter, split **pretext** from normal server code with `// nexus:pretext`. Optional `// nexus:server` continues the server-only block after pretext.

```text
---
import { db } from '$lib/db';

// nexus:pretext
export async function load(ctx) {
  const flow = await db.flows.find(ctx.params.id);
  return { flow };
}

// nexus:server
const extra = await somethingElse();
---
```

Supported exports (compiled to `nxPretext`):

- `export async function load(ctx) { ... }`
- `export const load = async (ctx) => { ... }`
- `export default async function (ctx) { ... }`

The function must return a **plain object** (non-objects are wrapped as `{ value: r }`). Later segments (child layouts, then page) **override keys** when merged.

## Server: `ctx.pretext` and templates

After merge, **`ctx.pretext`** holds the combined object. In templates you can use:

- **`{pretext.flow}`** — alias injected in `renderTemplate`
- **`ctx.pretext`** in server frontmatter
- **`$pretext().flow`** in the template SSR path (stubbed as the same data on the server)

Use **`ctx.redirect(url)`** or **`ctx.notFound()`** inside pretext; they propagate like the rest of the pipeline.

## Client: islands

Island bundles import **`$pretext`** from the runtime island entry:

```js
import { $pretext } from '/_nexus/rt/island.js';
```

The compiler adds this import for you. After hydration, **`$pretext()`** returns the same merged object the server used for SSR.

```js
const { flow } = $pretext();
```

`initPretextFromDocument()` runs automatically before **`hydrateAll()`** (initial load and after SPA navigation).

## SPA navigation

`/_nexus/navigate` returns fresh `headHTML` including `<script id="__NEXUS_PRETEXT__" type="application/json">`. The client router replaces that script in **`document.head`** so **`$pretext()`** matches the new route without a full reload.

## See also

- `packages/server/src/renderer.ts` — `mergeRoutePretext`, document injection
- `packages/runtime/src/pretext.ts` — `getPretext`, `$pretext`
- `packages/compiler/src/pretext-extract.ts` — frontmatter split and `nxPretext` transform
