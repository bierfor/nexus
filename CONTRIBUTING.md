# Contributing to Nexus.js

Thank you for your interest in contributing to Nexus! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

This project follows a code of conduct to ensure a welcoming environment for all contributors:

- Be respectful and inclusive
- Focus on constructive feedback
- Accept responsibility and apologize when mistakes are made
- Prioritize what's best for the community

## Getting Started

### Prerequisites

- **Node.js** ≥ 22 (use `.nvmrc` with `nvm use` or `fnm use`)
- **pnpm** ≥ 9 (required for workspace management)
- **Git** for version control

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/nexus.git
   cd nexus
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/bierfor/nexus.git
   ```

## Development Setup

### Install Dependencies

```bash
# Install Node.js (if using nvm)
nvm use

# Install pnpm (if not already installed)
npm install -g pnpm

# Install all workspace dependencies
pnpm install
```

### Build All Packages

```bash
# Build all packages in dependency order
pnpm build

# Or build specific package
cd packages/compiler
pnpm run build
```

### Run Examples

```bash
# Run the PayLinks SaaS demo (only maintained example in-tree)
pnpm dev:paylinks

# Or directly
cd examples/paylinks-saas
pnpm dev
```

## Project Structure

```
nexus/
├── packages/               # Published npm packages
│   ├── cli/               # nexus dev, build, studio
│   ├── compiler/          # .nx parser & codegen
│   ├── server/            # HTTP server, SSR, actions
│   ├── runtime/           # Client-side islands, navigation
│   ├── graphql/           # GraphQL integration (NEW)
│   ├── security/          # Vault, Shield, CSRF
│   └── ...                # 20+ packages total
├── examples/              # Demo applications
├── docs/                  # Contributor documentation
├── .github/workflows/     # CI/CD pipelines
└── scripts/               # Build and deployment scripts
```

### Key Packages

- **`@nexus_js/cli`** — Command-line interface for dev/build
- **`@nexus_js/compiler`** — Parses `.nx` files and generates JavaScript
- **`@nexus_js/server`** — HTTP server with SSR, streaming, and actions
- **`@nexus_js/runtime`** — Client-side code for islands and navigation
- **`@nexus_js/graphql`** — GraphQL integration with Shield security
- **`@nexus_js/security`** — Vault, CSRF, rate limiting

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/my-new-feature
# or
git checkout -b fix/bug-description
```

### 2. Make Changes

- Write code following our [coding standards](#coding-standards)
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run tests
pnpm test

# Run specific package tests
cd packages/compiler
pnpm test

# Type checking
pnpm run typecheck
```

### 4. Build and Verify

```bash
# Build all packages
pnpm build

# Test with the example app
cd examples/paylinks-saas
pnpm dev
```

## Testing

### Unit Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test --watch

# Specific package
cd packages/serialize
pnpm test
```

### Integration Tests

```bash
# Build and run integration tests
pnpm build
pnpm test:integration
```

### Manual Testing

```bash
# Create test app
cd /tmp
npm create @nexus_js/nexus test-app
cd test-app
npm install
npm run dev
```

## Pull Request Process

### Before Submitting

1. **Sync with upstream:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Ensure all tests pass:**
   ```bash
   pnpm test
   pnpm build
   ```

3. **Update documentation** if you changed APIs

4. **Run linter:**
   ```bash
   pnpm run lint
   ```

### Submitting PR

1. Push your branch:
   ```bash
   git push origin feature/my-new-feature
   ```

2. Open a Pull Request on GitHub

3. Fill out the PR template:
   - **Description:** What does this PR do?
   - **Motivation:** Why is this change needed?
   - **Testing:** How did you test this?
   - **Breaking Changes:** Does this break existing APIs?

4. Link related issues using `Fixes #123` or `Closes #456`

### PR Review Process

- Maintainers will review your PR within 1-5 days
- Address feedback by pushing new commits
- Once approved, a maintainer will merge your PR

## Coding Standards

### TypeScript

- Use **TypeScript 5.7+** features appropriately
- Prefer `interface` over `type` for object shapes
- Use explicit return types for public APIs
- Avoid `any` — use `unknown` and type guards instead

### Naming Conventions

- **Files:** `kebab-case.ts` (e.g., `server-action.ts`)
- **Classes:** `PascalCase` (e.g., `NexusServer`)
- **Functions:** `camelCase` (e.g., `createAction`)
- **Constants:** `SCREAMING_SNAKE_CASE` (e.g., `NEXUS_SECRET`)

### Code Style

- **Indentation:** 2 spaces
- **Quotes:** Single quotes for strings
- **Semicolons:** Required
- **Line length:** 100 characters max (soft limit)

### Comments

- Use JSDoc for public APIs:
  ```typescript
  /**
   * Creates a server action with validation and CSRF protection.
   * @param schema - Zod schema for input validation
   * @param handler - Action handler function
   * @returns Registered action function
   */
  export function createAction<T>(schema: z.Schema<T>, handler: ActionHandler<T>) {
    // ...
  }
  ```

- Avoid obvious comments — code should be self-documenting
- Explain **why**, not **what**

### Imports

- Use absolute imports for packages: `import { x } from '@nexus_js/server'`
- Use relative imports within a package: `import { y } from './utils'`
- Group imports: Node builtins → External → Internal → Relative

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation changes
- `style` — Code style changes (formatting, no logic change)
- `refactor` — Code refactoring
- `perf` — Performance improvements
- `test` — Adding or updating tests
- `chore` — Build process, dependencies, tooling

### Examples

```
feat(graphql): add complexity analysis for Shield

Implements AST-based cost calculation to prevent expensive queries.
Max cost configurable via `shield.maxCost` option.

Closes #42
```

```
fix(server): CSRF validation for fallback proxy

Requests proxied via `fallbackProxy` were bypassing CSRF checks.
Now validates before forwarding.
```

```
docs(readme): update GraphQL integration examples

Added DataLoader and JWT rotation examples.
```

## Release Process

(For maintainers only)

1. Update version in `package.json` files
2. Update `CHANGELOG.md`
3. Create release notes in `RELEASE_NOTES_X.Y.Z.md`
4. Build all packages: `pnpm build`
5. Run tests: `pnpm test`
6. Create git tag: `git tag v0.9.3`
7. Push tag: `git push origin v0.9.3`
8. Publish to npm: `pnpm publish -r`
9. Create GitHub release with notes

## Questions?

- **Issues:** Open an issue on GitHub for bug reports or feature requests
- **Discussions:** Use GitHub Discussions for questions and ideas
- **Email:** Contact maintainers for private concerns

---

## License

By contributing to Nexus, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to Nexus! 🚀
