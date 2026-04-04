<div align="center">

<img src="docs/assets/nexus-logo.svg" width="80" height="80" alt="Nexus" />

# Nexus

**The Definitive Full-Stack Framework**

Islands Architecture · Svelte 5 Runes · Server Actions · Edge-First · Zero-JS by Default

[![License: MIT](https://img.shields.io/badge/License-MIT-7c3aed.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9-f69220.svg)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-≥20-5fa04e.svg)](https://nodejs.org/)

**[Documentation — nexusjs.dev](https://nexusjs.dev)** · [Examples](./examples/) · [Contributing](./CONTRIBUTING.md) · [Changelog](./CHANGELOG.md) · [Publishing to npm](./docs/PUBLISHING.md)

</div>

---

## What is Nexus?

Nexus is a full-stack web framework that fuses the best architectural ideas of three generations of tools:

- **From Astro** — Islands Architecture: zero JavaScript by default, ship HTML first
- **From Svelte 5** — Runes: the finest reactive primitive system in the JavaScript ecosystem
- **From Next.js** — Full-stack power: Server Actions, file-based routing, Edge runtime, PPR

The result is a framework where the 90% of your page that doesn't need interactivity costs **zero bytes of JS**, while the 10% that does is progressively hydrated with surgical precision.

```
Traditional SPA:    ████████████████████ 400kb JS for a blog post
Nexus:              ▓                     18kb JS (only the like button)
```

---

## Features at a Glance

| Feature | Nexus | Next.js | Astro | SvelteKit |
|---|:---:|:---:|:---:|:---:|
| Islands Architecture | ✅ | ❌ | ✅ | ❌ |
| Svelte 5 Runes | ✅ | ❌ | ❌ | ✅ |
| Server Actions | ✅ | ✅ | ❌ | ✅ |
| SPA Navigation (Morphing) | ✅ | ✅ | ⚠️ | ✅ |
| Streaming SSR | ✅ | ✅ | ❌ | ❌ |
| Edge-Cache Auto-Headers | ✅ | ❌ | ❌ | ❌ |
| Global State Store | ✅ | ❌ | ❌ | ❌ |
| E2E Type Safety | ✅ | ⚠️ | ❌ | ⚠️ |
| Bundle Budget Analyzer | ✅ | ❌ | ❌ | ❌ |
| Zero config | ✅ | ⚠️ | ✅ | ⚠️ |

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

### Create a new project

```bash
npm exec --package=@nexus_js/cli@latest -- create-nexus my-app
cd my-app
pnpm dev
```

Or: `npm install -g @nexus_js/cli` then `create-nexus my-app`.

Official guides and API docs: **[nexusjs.dev](https://nexusjs.dev)**.

### Manual setup

```bash
pnpm add @nexus_js/server @nexus_js/runtime @nexus_js/router
```

**Maintainers:** publishing all packages to npm is documented in [docs/PUBLISHING.md](./docs/PUBLISHING.md) — use **`pnpm release`** after aligning versions with **`pnpm version:framework -- <semver>`**.

---

## The `.nx` Component Format

Nexus components use the `.nx` extension, a superset of HTML with three sections: a server frontmatter block, a reactive script block, and a template.

```html
---
// Server block — runs ONLY on the server, never in the browser
import { cache } from '@nexus_js/runtime';
import { defineHead } from '@nexus_js/head';

const posts = await cache('posts', () => fetch('/api/posts').then(r => r.json()), {
  ttl: 60,
  tags: ['post'],
});

defineHead({
  title: 'My Blog',
  description: 'Latest articles',
});
---

<script>
  // Island block — reactive, runs in the browser
  // Uses Svelte 5 Rune syntax
  let { initialCount = 0 } = $props();
  let count = $state(initialCount);
  let doubled = $derived(count * 2);

  $effect(() => {
    document.title = `Count: ${count}`;
  });
</script>

<template>
  <!-- Static HTML (zero JS cost) -->
  <ul>
    {#each posts as post}
      <li><a href="/blog/{post.slug}">{post.title}</a></li>
    {/each}
  </ul>

  <!-- Interactive island — hydrated lazily when visible -->
  <Counter client:visible initialCount={42} />
</template>

<style>
  /* Automatically scoped to this component via AOT hash */
  li { padding: 8px 0; }
</style>
```

---

## Island Hydration Directives

| Directive | When | Use Case |
|---|---|---|
| `client:load` | Immediately on page load | Critical UI (nav, modals) |
| `client:idle` | After `requestIdleCallback` | Non-critical widgets |
| `client:visible` | When entering the viewport | Below-the-fold content |
| `client:media="(min-width: 768px)"` | When media query matches | Responsive islands |
| `server:only` | Never (server render only) | Charts, complex SSR |

```html
<HeavyMap client:visible />
<Analytics server:only />
<Chatbot client:idle />
```

---

## File-Based Routing

```
src/routes/
├── +layout.nx          # Root layout (wraps all pages)
├── +page.nx            # → /
├── blog/
│   ├── +layout.nx      # Blog layout
│   ├── +page.nx        # → /blog
│   └── [slug]/
│       ├── +page.nx    # → /blog/:slug
│       └── +server.nx  # → GET/POST /blog/:slug (API)
├── (auth)/             # Route group (no URL segment)
│   ├── +layout.nx      # Auth layout
│   ├── login/+page.nx  # → /login
│   └── signup/+page.nx # → /signup
└── error.nx            # Error boundary
```

---

## Server Actions

Server Actions are typed, race-condition-safe, and use `@nexus_js/serialize` for transparent transport of complex types.

```typescript
// src/routes/blog/[slug]/+page.nx
---
async function publishPost(formData: FormData, ctx: NexusContext) {
  "use server";

  const post = await ctx.db.mutate('post', 'update', () =>
    ctx.db.client.post.update({
      where: { slug: ctx.params.slug },
      data: { published: true, publishedAt: new Date() },
    })
  );

  return post; // Date objects serialize automatically ✓
}
---
```

**Race condition strategies:**
```typescript
registerAction('save', saveFn, { race: 'cancel' });   // Cancel previous
registerAction('pay',  payFn,  { race: 'reject' });   // 409 if in flight
registerAction('log',  logFn,  { race: 'ignore' });   // All run in parallel
```

---

## Reactive Runes

Nexus implements Svelte 5 Rune semantics for island components:

```typescript
// Fine-grained reactivity
let count = $state(0);
let doubled = $derived(count * 2);
$effect(() => console.log('Count changed:', count));

// Props from server/parent
let { initialValue, onSave } = $props();

// Optimistic UI — instant update, auto-rollback on failure
const savePost = $optimistic(
  async (draft) => await callAction('savePost', draft),
  (current, draft) => ({ ...current, ...draft }),  // optimistic updater
);

// Synchronized state — stays in sync with cookies/session/DB
const theme = $sync('theme', {
  default: 'light',
  storage: 'cookie',
  path: '/',
});
```

---

## Global State Store

Zero hydration misses across SPA navigation:

```typescript
// In any island — state persists across /shop → /checkout
import { useStore } from '@nexus_js/runtime';

const cart = useStore('cart', {
  default: [] as CartItem[],
  persist: 'session',  // survives navigation
});

cart.value.push({ id: 'sku-123', qty: 1 });
// Automatically available in the next page's cart island
```

---

## Smart Edge-Cache Headers

Nexus computes `Cache-Control` automatically from your data's TTL:

```typescript
---
// TTL of 60 seconds → s-maxage=60, stale-while-revalidate=120
const data = await cache('posts', fetchPosts, { ttl: 60 });

// Session cookie detected → private, no-store (never CDN-cached)
const user = ctx.cookies.get('session');
---
```

No manual `Cache-Control` headers. The renderer aggregates TTLs from all `cache()` calls and picks the most conservative value.

---

## Database — Bring Your Own

Nexus doesn't bundle an ORM. It wraps your client with caching and invalidation:

```typescript
// nexus.config.ts
import { defineNexus } from '@nexus_js/cli';
import { defineDB } from '@nexus_js/db';
import { PrismaClient } from '@prisma/client';

export default defineNexus({
  db: defineDB(new PrismaClient(), { defaultTtl: 60 }),
});
```

```typescript
// Auto-cached query
const posts = await ctx.db.query('post', 'findMany', () =>
  ctx.db.client.post.findMany({ where: { published: true } })
);

// Auto-invalidates 'post' cache tag
const post = await ctx.db.mutate('post', 'create', () =>
  ctx.db.client.post.create({ data })
);
```

Supported adapters: **Prisma**, **Drizzle ORM**, **libSQL/Turso**, or any custom client via `defineDB()`.

---

## Nexus Studio

A real-time developer dashboard, zero dependencies:

```bash
nexus studio
# → Opens http://localhost:4000
```

Panels:
- **Layout Tree** — visual hierarchy of nested layouts for the current route
- **Island Map** — all live islands, their state, hydration strategy
- **Action Log** — real-time stream of Server Action calls with payloads and timings
- **Cache Inspector** — active cache entries, TTLs, hit/miss ratio
- **Store Viewer** — live snapshot of the Global State Store

---

## CLI Reference

```bash
nexus dev              # Start dev server with HMR (default: port 3000)
nexus build            # Build for production
nexus start            # Start production server
nexus studio           # Open Nexus Studio dashboard
nexus routes           # Print the route manifest
nexus check            # TypeScript type-check
nexus analyze          # Bundle budget report per route
create-nexus my-app    # Scaffold a new project
```

---

## Monorepo Architecture

The **framework** you install from npm (`@nexus_js/*`, `vite-plugin-nexus`) lives **only** in `packages/`. The `examples/` and `docs/` directories are demos and the marketing site — they are not published as framework packages.

```
nexus/
├── packages/
│   ├── compiler/          # .nx parser, codegen, CSS scoping, preload scanner
│   ├── runtime/           # Runes, islands, store, navigation, cache, optimistic, sync
│   ├── server/            # HTTP server, SSR renderer, streaming, actions, error boundaries
│   ├── router/            # File-based route manifest builder
│   ├── cli/               # nexus CLI + Nexus Studio dashboard
│   ├── assets/            # Image (AVIF/WebP) and font optimization
│   ├── head/              # SEO metadata manager (defineHead/useHead)
│   ├── middleware/         # Edge middleware (CORS, rate limit, auth, geo)
│   ├── serialize/          # SuperJSON-like serializer for complex types
│   ├── types/             # E2E type generation (nexus-types.d.ts)
│   ├── testing/           # Vitest/Playwright testing utilities
│   ├── vite-plugin-nexus/ # Vite plugin for HMR and build pipeline
│   └── db/                # BYOD DB thin provider (Prisma/Drizzle/libSQL)
├── examples/
│   └── basic/             # Starter example app
├── docs/
│   └── index.html         # Multilingual landing page (ES/EN/PT)
└── tsconfig.base.json     # Shared TypeScript configuration
```

---

## Deployment

Nexus targets the Web Platform. Any runtime that speaks `Request` / `Response` works:

| Platform | Status | Notes |
|---|---|---|
| Node.js (≥20) | ✅ Production | Default runtime |
| Cloudflare Workers | ✅ Production | Via `@nexus_js/middleware` adapter |
| Vercel Edge | ✅ Production | Via `@nexus_js/middleware` adapter |
| Deno Deploy | ✅ Production | Web-standard APIs only |
| Bun | ✅ Production | Drop-in Node.js compatibility |
| Docker / VPS | ✅ Production | `nexus build && nexus start` |

---

## Contributing

We welcome contributions of all kinds — bug reports, documentation, new adapters, or features. See [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

```bash
# Clone and set up
git clone https://github.com/bierfor/nexus.git
cd nexus
pnpm install
pnpm dev

# Run tests
pnpm test

# Type-check all packages
pnpm typecheck
```

---

## License

MIT © 2026 [Nexus Contributors](https://github.com/bierfor/nexus/graphs/contributors)

---

<div align="center">

Built with conviction that the web deserves better defaults.

**[Get Started → nexusjs.dev](https://nexusjs.dev)**

</div>
