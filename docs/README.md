# Nexus — documentation in this repository

This folder complements the official site **[nexusjs.dev](https://nexusjs.dev)**. Use it for contributor-focused and version-controlled reference.

| Document | Purpose |
|----------|---------|
| [PRETEXT.md](./PRETEXT.md) | Route `pretext` data loading, `// nexus:pretext`, and client hydration as `$pretext()` |
| [ISLANDS.md](./ISLANDS.md) | Islands architecture, `client:*` directives, and organizing `.nx` components |
| [PUBLISHING.md](./PUBLISHING.md) | Maintainer guide: versioning the monorepo and publishing `@nexus_js/*` packages to npm |
| [REPOSITORY.md](./REPOSITORY.md) | How to publish a **clean** GitHub repository (only framework-related files) |
| [index.html](./index.html) | Static multilingual landing (optional local preview) |

Assets live under [`docs/assets/`](./assets/): **`nexus-logo.svg`** — used in the root README, **`docs/index.html`** (favicon, `apple-touch-icon`, hero, sidebar, mobile bar, `og:image` / `twitter:image`, JSON-LD `Organization.logo`), and mirrored in **`examples/nexusflow/public/favicon.svg`**. New projects from **`create-nexus`** get the same file as **`public/favicon.svg`**. Legacy **`.ico`**: export PNG sizes from the SVG and pack with ImageMagick or [RealFaviconGenerator](https://realfavicongenerator.net).
