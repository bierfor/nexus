# Nexus — documentation in this repository

**Relationship:** **[nexusjs.dev](https://nexusjs.dev)** is the public marketing site; its repo is **[github.com/bierfor/nexusjs-site](https://github.com/bierfor/nexusjs-site)**. That site **documents and links to** the framework, which lives here: **[github.com/bierfor/nexus](https://github.com/bierfor/nexus)** (`packages/`, CLI, runtime). When you change the landing copy, update **`docs/index.html`** in this monorepo and copy it to **nexusjs-site** for deployment.

**Not on npm:** nothing under **`docs/`** is published to the npm registry. End users get the framework from **`@nexus_js/*`** packages (built from [`packages/`](../packages/)); framework source is **[github.com/bierfor/nexus](https://github.com/bierfor/nexus)**. See [`PUBLISHING.md`](./PUBLISHING.md) — `pnpm release` only publishes **`packages/*`**.

Local preview of **`index.html`**: use **Node.js ≥ 22** (repo **`.nvmrc`**) and serve the `docs` folder as you prefer.

| Document | Purpose |
|----------|---------|
| [PRETEXT.md](./PRETEXT.md) | Route `pretext` data loading, `// nexus:pretext`, and client hydration as `$pretext()` |
| [ISLANDS.md](./ISLANDS.md) | Islands architecture, `client:*` directives, and organizing `.nx` components |
| [PUBLISHING.md](./PUBLISHING.md) | Maintainer guide: versioning the monorepo and publishing `@nexus_js/*` packages to npm |
| [REPOSITORY.md](./REPOSITORY.md) | How to publish a **clean** GitHub repository (only framework-related files) |
| [index.html](./index.html) | Static multilingual landing — deploy source of truth: [nexusjs-site](https://github.com/bierfor/nexusjs-site) |

Assets live under [`docs/assets/`](./assets/): **`nexus-logo.svg`** — used in the root README, **`docs/index.html`** (favicon, `apple-touch-icon`, hero, sidebar, mobile bar, `og:image` / `twitter:image`, JSON-LD `Organization.logo`), and mirrored in **`examples/nexusflow/public/favicon.svg`**. New projects from **`create-nexus`** get the same file as **`public/favicon.svg`**. Legacy **`.ico`**: export PNG sizes from the SVG and pack with ImageMagick or [RealFaviconGenerator](https://realfavicongenerator.net).
