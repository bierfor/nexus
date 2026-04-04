# Contributing to Nexus

Thank you for your interest in contributing to Nexus. This document explains the process for contributing code, reporting bugs, requesting features, and writing documentation.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Adding a New Package](#adding-a-new-package)
- [Publishing to npm (maintainers)](#publishing-to-npm-maintainers)
- [Writing Tests](#writing-tests)
- [Reporting Bugs](#reporting-bugs)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards. Report unacceptable behavior to the maintainers.

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Install** dependencies
4. **Create** a branch for your change

```bash
git clone https://github.com/<your-username>/nexus.git
cd nexus
pnpm install
git checkout -b feat/your-feature-name
```

---

## Development Setup

### Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 20.0.0 |
| pnpm | ≥ 9.0.0 |
| TypeScript | ≥ 5.4 (installed automatically) |

### Commands

```bash
# Build all packages
pnpm build

# Start all packages in watch mode
pnpm dev

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Run the basic example
pnpm example

# Open Nexus Studio
pnpm studio
```

### Working on a specific package

```bash
# Build only @nexus_js/runtime
pnpm --filter @nexus_js/runtime build

# Run tests for @nexus_js/serialize
pnpm --filter @nexus_js/serialize test

# Dev mode for @nexus_js/compiler
pnpm --filter @nexus_js/compiler dev
```

---

## Project Structure

**Published framework:** everything users install from npm (`@nexus_js/*`, `vite-plugin-nexus`) is developed under **`packages/`** only. **`examples/`** are sample apps; **`docs/`** is the static site — neither is published as a framework package.

```
nexus/
├── packages/
│   ├── compiler/          # .nx → JS transform (parser, codegen, CSS scoping)
│   ├── runtime/           # Client-side: runes, islands, store, navigation
│   ├── server/            # HTTP server, SSR, actions, streaming, error boundaries
│   ├── router/            # File-based route manifest
│   ├── cli/               # nexus CLI + Nexus Studio
│   ├── assets/            # Image and font optimization
│   ├── head/              # <head> metadata manager
│   ├── middleware/         # Edge middleware
│   ├── serialize/          # Complex type serialization
│   ├── types/             # E2E type generation
│   ├── testing/           # Test utilities
│   ├── vite-plugin-nexus/ # Vite integration
│   └── db/                # DB adapter layer
├── examples/
│   └── basic/             # Reference app
└── docs/
    └── index.html         # Landing page
```

**Dependency rules (enforced by convention):**

```
compiler  → (no @nexus_js deps)
runtime   → serialize
router    → (no @nexus_js deps)
server    → compiler, runtime, router, serialize, assets, head
cli       → server, compiler, router
db        → runtime, serialize
```

---

## Making Changes

### Coding Style

- **TypeScript** strictly — no `any`, no `@ts-ignore` without comment
- **ESM only** — no CommonJS (`require`), no default exports from barrel files
- **Web APIs first** — prefer `Request`/`Response`/`ReadableStream` over Node.js APIs when feasible
- **No comments narrating code** — comments explain *why*, not *what*
- **Exports must be explicit** — every public API needs a JSDoc comment

### TypeScript conventions

```typescript
// ✅ Good
export interface MyOptions {
  /** Maximum retry count. Default: 3 */
  retries?: number;
}

// ❌ Bad
export interface MyOptions {
  retries?: any; // retry count
}
```

---

## Commit Convention

Nexus uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code change that doesn't add a feature or fix a bug |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `chore` | Tooling, dependencies, config |
| `ci` | CI/CD pipeline changes |

### Scopes

Use the package name without the `@nexus_js/` prefix:

```
feat(runtime): add $sync rune persistence modes
fix(compiler): handle empty style blocks in .nx parser
perf(server): reduce streaming overhead with TransformStream
docs(readme): add DB adapter usage examples
```

### Examples

```bash
git commit -m "feat(runtime): add useStore() global state with session persistence"
git commit -m "fix(server): prevent double cache-control header emission"
git commit -m "chore: upgrade typescript to 5.5"
```

---

## Pull Request Process

1. **Keep PRs focused** — one feature or fix per PR
2. **Update tests** — every change should include or update tests
3. **Update docs** — if you change a public API, update the README and JSDoc
4. **Passes CI** — all checks must pass before merge
5. **One approving review** required from a maintainer

### PR Title Format

Same as commit convention: `feat(runtime): add $sync rune`

### PR Description Template

See `.github/pull_request_template.md`.

---

## Adding a New Package

1. Create the directory:
   ```bash
   mkdir -p packages/my-package/src
   ```

2. Copy `package.json` structure from an existing package (e.g., `packages/head`):
   ```json
   {
     "name": "@nexus_js/my-package",
     "version": "0.1.0",
     "type": "module",
     "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
     "scripts": { "build": "tsc", "dev": "tsc --watch" }
   }
   ```

3. Add `tsconfig.json` extending `../../tsconfig.base.json`

4. Create `src/index.ts` with public API

5. Add to `packages/` — pnpm workspaces picks it up automatically

6. If other packages depend on it, add it to their `dependencies` as `"@nexus_js/my-package": "workspace:*"`

---

## Publishing to npm (maintainers)

Official instructions (authentication, **`pnpm release`** for the full framework, **`pnpm version:framework`**, troubleshooting) are in **[docs/PUBLISHING.md](./docs/PUBLISHING.md)**. The public site and package metadata use **[nexusjs.dev](https://nexusjs.dev)** as the canonical homepage.

---

## Writing Tests

Tests live in `src/*.test.ts` within each package. We use **Vitest**.

```typescript
// packages/my-package/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from './index.js';

describe('myFunction', () => {
  it('handles the happy path', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('throws on invalid input', () => {
    expect(() => myFunction('')).toThrow('Invalid input');
  });
});
```

Run tests:
```bash
pnpm --filter @nexus_js/my-package test
# or in watch mode:
pnpm --filter @nexus_js/my-package test -- --watch
```

---

## Reporting Bugs

Use the GitHub Issues bug report template. Include:

- Nexus version (`nexus --version`)
- Node.js version (`node --version`)
- Minimal reproduction (ideally a repository or StackBlitz link)
- Expected vs. actual behavior
- Error message and stack trace if applicable

---

## Questions?

Open a [GitHub Discussion](https://github.com/bierfor/nexus/discussions) for questions, ideas, or RFCs. Issues are for actionable bugs and feature requests.
