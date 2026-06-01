<div align="center">

<img src="docs/assets/nexus-logo.svg" width="80" height="80" alt="Nexus logo" />

# Nexus.js

**Full-stack framework** — islands-first HTML, **Svelte 5** runes, **server actions**, file-based routes, streaming SSR, and **production-ready deployment**.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c3aed.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9-f69220.svg)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-≥22-5fa04e.svg)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/@nexus_js/cli?label=latest)](https://www.npmjs.com/package/@nexus_js/cli)

[Website — nexusjs.dev](https://nexusjs.dev) · [Documentation](https://nexusjs.dev/docs) · [Examples](#examples) · [Changelog](./CHANGELOG.md)

</div>

---

## 🚀 What is Nexus?

Nexus is a **security-first, production-ready** web framework that combines:

- **🏝️ Islands Architecture** — Ship minimal JavaScript; only hydrate interactive components
- **⚡ Svelte 5 Runes** — `$state`, `$derived`, `$effect` for reactive UI
- **🔒 Built-in Security** — CSRF protection, CSP headers, rate limiting, Shield-lite, Vault
- **📡 Server Actions** — Type-safe RPC without API routes
- **🗂️ File-based Routing** — `+page.nx`, `+layout.nx`, `[params]`
- **🌊 Streaming SSR** — First byte in <50ms with suspense boundaries
- **📦 GraphQL Integration** — Shield-protected API with complexity analysis
- **🔄 Legacy Bridge** — Migrate Express/Node apps gradually with zero downtime

### Why Nexus?

Most frameworks force you to choose between simplicity and production-readiness. Nexus gives you both:

- **Start simple** — Create a page in 10 lines, no boilerplate
- **Scale securely** — Built-in CSRF, XSS prevention, secret management
- **Migrate safely** — Wrap existing Express apps, proxy legacy backends
- **Deploy anywhere** — Docker, VPS, serverless (edge runtime coming soon)

---

## Quick Start

### Create a new app

```bash
npm create @nexus_js/nexus my-app
cd my-app
npm install
npm run dev
```

Visit `http://localhost:3000` and start building!

> **Peer dependencies note**: When installing framework packages manually (`@nexus_js/server`, `@nexus_js/cli`, etc.), you may need to also install `@nexus_js/runtime` (for islands) and `@nexus_js/compiler` (for dev/build). The official `npm create @nexus_js/nexus` scaffold handles this for you.

### Your first page

Create `src/routes/+page.nx`:

```svelte
---
// Server-only code (runs once per request)
const greeting = "Hello, Nexus!";

export async function load(ctx) {
  return { user: { name: "Developer" } };
}
---

<h1>{greeting}</h1>
<p>Welcome, {pretext.user.name}</p>

<!-- Interactive island -->
<div client:load>
  <script>
    let count = $state(0);
  </script>
  <button onclick={() => count++}>
    Clicked {count} times
  </button>
</div>

<style>
  h1 { color: #5b21b6; }
  button {
    padding: 0.5rem 1rem;
    background: #5b21b6;
    color: white;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
  }
</style>
```

---

## Core Features

### 🏝️ Islands Architecture

Ship only the JavaScript you need. Static HTML by default, JavaScript where needed:

```svelte
<!-- Static -->
<h1>Fast, SEO-friendly content</h1>

<!-- Interactive island (hydrates in browser) -->
<div client:load>
  <script>
    let open = $state(false);
  </script>
  <button onclick={() => open = !open}>Toggle</button>
  {#if open}<p>Dynamic content</p>{/if}
</div>
```

**Hydration strategies:** `client:load`, `client:idle`, `client:visible`, `client:media="(min-width: 768px)"`

### 🔒 Security by Default

No configuration needed — security is built-in:

- ✅ **CSRF Protection** — Automatic token validation
- ✅ **Content Security Policy** — XSS prevention out of the box
- ✅ **Rate Limiting** — Per-action throttling
- ✅ **Secret Management** — Vault with hot-reload rotation
- ✅ **Input Validation** — Zod integration for type-safe forms
- ✅ **Signed Actions** — Prevent action replay attacks

### 📡 Server Actions

Type-safe backend calls without writing API routes:

```svelte
---
import { z } from 'zod';

export async function createPost(formData, ctx) {
  // Rate limiting built-in
  if (!ctx.rateLimit('createPost', { max: 10, window: 60_000 })) {
    return { error: 'Too many requests', status: 429 };
  }

  // Validation with Zod
  const result = z.object({
    title: z.string().min(3),
    content: z.string().min(10),
  }).safeParse({
    title: formData.get('title'),
    content: formData.get('content'),
  });

  if (!result.success) return { error: 'Invalid input' };

  await db.posts.create(result.data);
  return { redirect: '/posts' };
}
---

<form method="post" action="/_nexus/action/createPost">
  <input name="title" required />
  <textarea name="content" required></textarea>
  <button type="submit">Create Post</button>
</form>
```

### 📦 GraphQL with Shield

Production-ready GraphQL with built-in security:

```typescript
import { createGraphQLHandler } from '@nexus_js/graphql';
import { nexusVault } from '@nexus_js/security';

const handler = createGraphQLHandler({
  schema,
  shield: {
    maxCost: 500,        // Prevent expensive queries
    maxDepth: 8,         // Limit nesting
    allowIntrospection: false,
  },
  mask: {
    'User.passwordHash': null,      // Redact sensitive fields
    'User.apiKey': (val, ctx) => 
      ctx.user?.role === 'admin' ? val : null,
  },
  rateLimit: { max: 60, windowMs: 60_000 },
});

// Mount at /graphql
export default {
  server: {
    mounts: [{ path: '/graphql', handler }],
  },
};
```

### 🔄 Legacy Bridge

Migrate existing backends without downtime:

```typescript
import { createRemoteExecutor } from '@nexus_js/graphql';
import { wrapExpressMiddleware } from '@nexus_js/server';

// Proxy to old GraphQL API
const legacyApi = createRemoteExecutor({
  url: 'https://old-api.company.com/graphql',
  headers: { 'x-api-key': vault.get('LEGACY_KEY') },
});

// Wrap Express middleware as Nexus action
export const legacyPayment = wrapExpressMiddleware(oldExpressHandler);

// HTTP fallback proxy
export default {
  server: {
    fallbackProxy: 'http://localhost:8080', // Old backend
  },
};
```

---

## Examples

This repository includes one production-ready example:

- **[paylinks-saas](./examples/paylinks-saas)** — Payment link generator with Stripe, QR codes, Vault UI, and Prisma (mock data in current version; see TODOs in source)

Run it:

```bash
cd examples/paylinks-saas
pnpm install
pnpm dev
```

Additional historical examples (pokedex, basic, nexusflow, anonymous-chat) exist in git history but are no longer maintained in-tree.

---

## Deployment

### Docker (Recommended)

```bash
# Build image
docker build -t my-nexus-app .

# Run with docker-compose
docker-compose up -d
```

### Manual Deployment

```bash
# Build for production
npm run build

# Start server
NODE_ENV=production npm start
```

### Environment Variables

```bash
# Required
NEXUS_SECRET="your-32-character-secret"
DATABASE_URL="postgresql://..."

# Optional
NEXUS_PORT=3000
STRIPE_SECRET_KEY="sk_live_..."
```

See [Deployment Guide](https://nexusjs.dev/docs#deploy) for VPS, Docker, and CI/CD setup.

---

## Monorepo Structure

```
nexus/
├── packages/
│   ├── cli/               # nexus dev, build, studio
│   ├── server/            # HTTP server, SSR, actions
│   ├── compiler/          # .nx parser & codegen
│   ├── runtime/           # Client-side (islands, navigation)
│   ├── graphql/           # GraphQL integration (NEW in 0.9.3)
│   ├── security/          # Vault, Shield, CSRF
│   ├── router/            # File-based routing
│   └── ...                # 20+ packages total
├── examples/
│   └── paylinks-saas/     # Full SaaS example (Stripe + Prisma + islands)
└── docs/                  # Contributor guides
```

---

## Development

**Requirements:** Node.js ≥22, pnpm ≥9

```bash
# Clone repo
git clone https://github.com/bierfor/nexus.git
cd nexus

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Start the example
pnpm dev:paylinks
# or
cd examples/paylinks-saas && pnpm dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed development guide.

---

## Documentation

- **[Official Docs](https://nexusjs.dev/docs)** — Complete framework guide
- **[Learn](https://nexusjs.dev/learn)** — Interactive tutorials
- **[API Reference](./docs/README.md)** — Package documentation
- **[Changelog](./CHANGELOG.md)** — Release notes

---

## Community & Support

- **[GitHub Issues](https://github.com/bierfor/nexus/issues)** — Bug reports & feature requests
- **[Buy Me a Coffee](https://buymeacoffee.com/bierfor084)** — Support development

---

## License

MIT © 2024-2026 Nexus.js Contributors

See [LICENSE](./LICENSE) for details.

---

<div align="center">

**Built with ❤️ by [bierfor](https://github.com/bierfor)**

[⭐ Star on GitHub](https://github.com/bierfor/nexus) · [📖 Read the Docs](https://nexusjs.dev) · [🚀 Get Started](https://nexusjs.dev/docs#install)

</div>

## Feature snapshot

| Area | Highlights |
|------|------------|
| Rendering | Islands, streaming SSR, automatic cache-related `Cache-Control` hints |
| Data | Pretext merged into `$pretext()`, `cache()` with tags/TTL |
| Client | Global store, optimistic updates, SPA-style navigation where enabled |
| Tooling | `nexus dev | build | start | check | studio`, bundle analysis |

---

## Contributing

Issues and pull requests are welcome. See [**CONTRIBUTING.md**](./CONTRIBUTING.md) (setup, structure, commits, tests). To **replace or recreate the GitHub remote** with a clean tree only, follow [**docs/REPOSITORY.md**](./docs/REPOSITORY.md).

---

## License

MIT — see [LICENSE](./LICENSE).
