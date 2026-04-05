# Publishing Nexus to npm

This document is for **maintainers** who publish the `@nexus_js/*` packages (including **`@nexus_js/create-nexus`**, which powers **`npm create @nexus_js/nexus`**) and **`vite-plugin-nexus`**, to the public npm registry.

**Unscoped CLI aliases** on npm — **`nexus-js`** and **`nexus_js`** — are thin meta packages (under `packages/nexus-js` and `packages/nexus_js`); they depend on `@nexus_js/cli` and are published together with `pnpm release` so users can run `npm install -g nexus-js` or `npm install -g nexus_js`.

**Where the framework lives:** the installable framework is **only** under [`packages/`](../packages/). Folders like `examples/` and `docs/` are sample apps and marketing content — they are **not** published to npm. Release commands only touch **`packages/*`**.

**npm organization:** scoped packages use the **`@nexus_js`** scope, which belongs to the **`nexus_js`** org on npm. Maintainers can see and manage published packages here: **[npmjs.com/settings/nexus_js/packages](https://www.npmjs.com/settings/nexus_js/packages)**. (The unscoped **`vite-plugin-nexus`** package appears under your account or team that owns it, not inside that org’s scoped list.)

## Pre-release: verify locally

Before you bump versions or run `pnpm release`:

1. **Build** — from the monorepo root: `pnpm build`.
2. **Tests** — `pnpm test` (includes compiler island codegen checks where present).
3. **Smoke** (recommended) — install deps in a sample app, then `nexus build` and/or `nexus dev` (e.g. an app under `examples/*` or a project created with `create-nexus`).

When that looks good, align versions with `pnpm version:framework -- <semver>`, commit, then publish with **`pnpm release`** (build only) or **`pnpm release:safe`** (build **and** `pnpm test`, then publish). If **`vite-plugin-nexus`** is still in npm’s post-unpublish cooldown, use `pnpm release:skip-vite-plugin` first, then `pnpm publish:package -- vite-plugin-nexus` when allowed.

## Full framework release (what most teams do)

This is the same idea as **Next.js**, **Svelte**, **Remix**, etc.: one repo, many npm packages, **one aligned version**, published in **dependency order** with a single workflow from the root.

### 1. Log in to npm (or set `NPM_TOKEN`)

See [Authenticate](#authenticate-local-or-ci) below. Publishing needs a token with rights on **`@nexus_js/*`**, **`vite-plugin-nexus`**, and (for CI) **bypass 2FA** if your org requires it.

### 2. Align the version on every package

All `packages/*/package.json` (and the workspace root) should share the **same** `version` before you ship:

```bash
pnpm version:framework -- 0.8.0
```

Replace `0.8.0` with your next semver. Commit the version bump when you are ready (many teams also add a git tag `v0.8.0`).

### 3. Build and publish **all** framework packages

```bash
pnpm release
```

This runs **`pnpm build`** for everything under `packages/*`, then **`pnpm publish -r --filter './packages/*'`** with **`--access public`**, **`--no-git-checks`**, and **`--report-summary`** (writes **`pnpm-publish-summary.json`** at the repo root listing what was published — useful for CI logs). pnpm resolves the graph and publishes in the right order; `workspace:*` dependencies in `package.json` are rewritten to real versions on the tarballs that go to npm.

**Aliases:** `pnpm publish:npm` is the same as `pnpm release`. **`pnpm release:safe`** runs **`pnpm build`**, then **`pnpm test`**, then the same recursive publish as `pnpm release` — use it when you want CI-style gating before npm.

If **`vite-plugin-nexus`** fails with *“cannot be republished until 24 hours have passed”*, npm is enforcing the cooldown after an **unpublish** of that package (see [npm unpublish policy](https://docs.npmjs.com/policies/unpublish)). Publish everything else now, then publish the plugin after the window:

```bash
pnpm release:skip-vite-plugin
# …wait until npm allows it (often ~24h from unpublish, server time)…
pnpm publish:package -- vite-plugin-nexus
```

**Requirements:**

- Run **`pnpm release` only from the monorepo root** (where `pnpm-workspace.yaml` lives). Do not `cd` into a single package and expect the whole framework to publish unless you intend a single-package release (`pnpm publish:package`).
- **Authenticate** first (`npm login` or `NPM_TOKEN` / `NODE_AUTH_TOKEN` for CI).
- **Bump versions** before a new release (`pnpm version:framework -- <semver>`). If every `packages/*/package.json` version **already exists on the registry**, pnpm may report *“There are no new packages that should be published”* — that is expected until you bump.
- To **re-publish the same version** to npm (rare; usually avoid), you would need **`pnpm publish --force`** on the relevant package; the default is to skip duplicates.

### 4. Dry run (optional)

From the repo root, a **recursive** dry run only simulates packages that pnpm would still publish (often none if the current version is already on npm). To **inspect the tarball** any time:

```bash
pnpm build
cd packages/cli && pnpm publish --dry-run --no-git-checks
```

Recursive dry run (when you have bumped versions not yet on the registry):

```bash
pnpm build
pnpm publish -r --filter './packages/*' --dry-run --no-git-checks
```

### Optional: publish a single package only

Sometimes you only need one package (hotfix or testing):

```bash
pnpm publish:package -- @nexus_js/assets
```

Or manually:

```bash
pnpm --filter '@nexus_js/assets...' run build
pnpm --filter @nexus_js/assets publish --access public --no-git-checks
```

The **`...` suffix** (`@nexus_js/assets...`) means “this package and its workspace dependencies” so builds are consistent.

## Prerequisites

- **Node.js** ≥ 22 and **pnpm** ≥ 9 (see root `package.json` → `engines` and **`.nvmrc`**).
- An npm account with permission to publish:
  - the **`@nexus_js` scope** (create an [npm org](https://www.npmjs.com/org/create) whose scope matches **`@nexus_js`** on npm), and
  - the unscoped package **`vite-plugin-nexus`** (if that name is available on npm).
- A valid **granular access token** from [npm Access Tokens](https://www.npmjs.com/settings/~/tokens).  
  If your account uses **two-factor authentication (2FA)** for publishing, a classic token is not enough for `npm publish`—see **403 / Two-factor authentication** under [Troubleshooting](#troubleshooting) below.  
  **Never commit tokens**, paste them into issues/chats, or store them in this repository.

## Authenticate (local or CI)

### Local (interactive)

```bash
npm login
```

### CI or non-interactive

Set the token in the environment (example name only):

```bash
export NPM_TOKEN="your_secret_token_here"
```

Then ensure npm can read it, for example in `~/.npmrc` (outside the repo):

```
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

Or inline for a single command (shell-specific; avoid logging the value):

```bash
NPM_TOKEN="..." pnpm publish
```

## Build

From the repository root:

```bash
pnpm install
pnpm build
```

All publishable packages emit compiled output under each package’s `dist/` directory.

### What gets published (like Next.js, Astro, etc.)

Frameworks on npm ship **compiled JavaScript** and **`.d.ts` types**, not raw `src/*.ts`:

- **Development** in this repo uses TypeScript, tests, and source maps.
- **Publication** runs `pnpm build` (each package uses `tsc` or the package’s `build` script) so consumers receive **`dist/**/*.js`**, **`dist/**/*.d.ts`**, and source maps — Node can run them without a user-side transpiler.

Each `packages/*/package.json` uses:

- **`"main"` / `"types"` / `exports`** pointing at **`./dist/...`**
- **`"files": ["dist", "README.md"]`** as a **whitelist** — npm packs only those paths (not `src/`, tests, or config). We do **not** rely on `.npmignore` for the default case.

**Verify the tarball before publishing:**

```bash
cd packages/assets
pnpm pack --pack-destination /tmp
tar -tzf /tmp/nexus_js-assets-*.tgz | head -40
```

You should see `package/dist/*.js` and `package/dist/*.d.ts`, not `package/src/*.ts`. From the repo root, `pnpm -r --filter './packages/*' pack` is not built-in; use **`pnpm pack`** inside a package directory or inspect with **`pnpm -r publish --dry-run`** (shows “Tarball Contents”).

## Pre-flight: version consistency

Before `pnpm release`, every published package under `packages/*` should use the **same semver** in its `"version"` field (e.g. all `0.6.1`, not a mix of `0.6.0` and `0.6.1`). Use **`pnpm version:framework -- <semver>`** to sync versions, or [Changesets](https://github.com/changesets/changesets) if you adopt it later.

**Manual check (quick):**

```bash
pnpm -r --filter './packages/*' exec node -p "require('./package.json').name + ' ' + require('./package.json').version"
```

Scan the output and confirm every line shows the intended version.

**Automation (optional):** use [Changesets](https://github.com/changesets/changesets), [semantic-release](https://github.com/semantic-release/semantic-release), or community tools such as [multi-semantic-release](https://github.com/dhoulb/multi-semantic-release) to bump versions in lockstep. Pick one workflow and document it for the team.

## `workspace:*` dependencies (no manual rewrites)

In this monorepo, internal dependencies look like:

```json
"@nexus_js/compiler": "workspace:*"
```

During **`pnpm publish`** (from the workspace root), pnpm **rewrites** those specifiers to the **actual published version** (e.g. `"@nexus_js/compiler": "0.6.1"`) in the tarball that npm receives. You do **not** need to replace `workspace:*` by hand before publishing.

**Do not run `npm publish` or bare `pnpm publish` on the monorepo root** unless you intend to publish the root `package.json`. The root is **private** (`nexus-workspace`) so it does not collide with the unrelated public package [`nexus`](https://www.npmjs.com/package/nexus).

### First-time scope and `--access public`

Each scoped package has `"publishConfig": { "access": "public" }`. **`pnpm release`** also passes **`--access public`**. On the first publish of a new scope, that flag avoids npm treating scoped packages as private (paid plan).

## Documentation and homepage

- **Official site:** [https://nexusjs.dev](https://nexusjs.dev) — static site source: [https://github.com/bierfor/nexusjs-site](https://github.com/bierfor/nexusjs-site)
- **Framework monorepo:** [https://github.com/bierfor/nexus](https://github.com/bierfor/nexus)

Each published package includes `homepage`, `repository`, and `bugs` fields pointing at these URLs.

## Apps using Nexus: build ID in CI (0.8.0+)

Downstream apps (not this monorepo) that run **`nexus build`** should set **`NEXUS_BUILD_ID`** in the build environment — typically the **git commit SHA** or **container image digest** — so **`.nexus/build-id.json`** matches what you deploy. The production server and **`callAction`** use that id to return **412 `BUILD_MISMATCH`** when a tab still has an old bundle after a deploy. See **[`docs/PRODUCTION.md`](./PRODUCTION.md)** for the full contract.

Use **`pnpm install --frozen-lockfile`** (or npm/yarn equivalents) in CI so installs are reproducible.

## CI: GitHub Actions (example)

To automate publish from GitHub, store an npm **granular token** as a repository secret (e.g. `NPM_TOKEN`) with permission to publish to `@nexus_js/*` and `vite-plugin-nexus`, including **bypass 2FA** if your account requires it.

Example workflow (adjust branches and Node version as needed):

```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - name: Publish to npm
        run: pnpm release
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          # Optional: npm provenance (supply-chain attestation on npm; requires a public repo + compatible token)
          # NPM_CONFIG_PROVENANCE: 'true'
```

`actions/setup-node` with `registry-url` wires **`NODE_AUTH_TOKEN`** into npm’s auth for the publish step. If you prefer `~/.npmrc` with `NPM_TOKEN`, export that variable in the step that runs `pnpm release` instead.

After publish, check **`pnpm-publish-summary.json`** in the repo root (generated by **`--report-summary`**) or the workflow log.

## Troubleshooting

### `403 Forbidden` — Two-factor authentication

If npm prints something like:

> Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.

Then your account requires 2FA for publishing. Fix it in one of these ways:

1. **Granular token (recommended for CI and scripts)**  
   In [Access Tokens](https://www.npmjs.com/settings/~/tokens), create a **Granular Access Token** with:
   - **Packages and scopes:** the `@nexus_js/*` packages (or “All packages” while testing).
   - **Permissions:** at least **Read and write** (publish).
   - Enable **Bypass two-factor authentication** (wording may vary slightly).  
   Use that token as `NPM_TOKEN` / `~/.npmrc` `_authToken` for non-interactive publish.

2. **Interactive publish**  
   Run `npm login` (complete 2FA when prompted), then from the repo root run `pnpm release` in the same terminal so the session is authenticated. Some flows still expect an OTP for each publish unless you use a granular token with bypass.

3. **Account 2FA settings**  
   Under [npm account security](https://www.npmjs.com/settings/~/security), check whether “Authorization and publishing” requires 2FA; that is what triggers this rule for tokens.

### `404 Not Found` on `PUT …/@nexus_js/…`

If npm shows something like:

> `404 Not Found - PUT https://registry.npmjs.org/@nexus_js%2fassets`  
> The requested resource `@nexus_js/assets@…` could not be found or you do not have permission

then authentication may have succeeded, but **your npm user cannot publish under the `@nexus_js` scope**. npm often returns **404** (not 403) when the scope exists but you are not a member, or when the name is taken by another org.

**Fix:**

1. **Create or join the org** — This repo publishes scoped packages as **`@nexus_js/*`**. On [npm Organizations](https://www.npmjs.com/org/create), create or join an organization that owns the **`@nexus_js`** scope and ensure your user is an **owner** or **member with publish** rights.
2. **If `@nexus_js` is taken** — Choose another npm scope, then rename all `name` fields in `packages/*/package.json` and all imports from `@nexus_js/` to your scope (same kind of change as migrating off `@nexus`).

3. **User scope** — Alternatively publish under **`@your-npm-username/package-name`**, which always works for your account with `publishConfig.access: public`.

Until your account may publish **`@nexus_js/*`**, `pnpm release` will fail at the first scoped package.

### Other issues

| Issue | What to check |
|--------|----------------|
| `403 Forbidden` on `@nexus_js/*` (other causes) | Scope ownership and token permissions (publish to that scope). |
| `403` on `vite-plugin-nexus` — *cannot be republished until 24 hours* | npm blocks **new publishes** to a name for **~24 hours** after **all versions were unpublished**. Use **`pnpm release:skip-vite-plugin`**, then **`pnpm publish:package -- vite-plugin-nexus`** when the cooldown ends. Clock is **npm’s servers (UTC)**; “not 24h locally” can still be inside the window. |
| `403` on `vite-plugin-nexus` (other) | Name taken by another account, or no publish permission. |
| `workspace:*` still inside the tarball on npm | You published from outside the workspace root or without pnpm’s workspace publish flow. Run **`pnpm release`** from the monorepo root so pnpm rewrites `workspace:*` to concrete versions. |
| Missing `dist/` | Run `pnpm build` before publish; `files` in `package.json` only includes `dist` and `README.md`. |
| `Cannot implicitly apply the "latest" tag … 1.3.0 is higher than … 0.6.0` | You tried to publish a package named **`nexus`** whose version is **below** the version already on npm for that name. Use **`pnpm release`** (only `packages/*`), not `npm publish` from the repo root. If you really must publish an older line, use an explicit dist-tag: `npm publish --tag 0.x`. |
| `There are no new packages that should be published` | Current versions are **already on the registry**. Bump with **`pnpm version:framework -- <new-semver>`**, commit, rebuild, then **`pnpm release`** again. |

## Unpublish (maintainers only)

Removing packages from npm breaks installs for anyone who pinned them; use rarely. If you must remove **all** framework packages, use the ordered script (dependents first) after `npm login`:

```bash
DRY_RUN=1 ./scripts/unpublish-all-packages.sh   # preview
./scripts/unpublish-all-packages.sh             # real
```

If npm returns **403** and asks for an **OTP** (TFA is required for publish *and* unpublish on many orgs), use a **granular access token** with **bypass 2FA**, or paste a fresh code for each package:

```bash
PROMPT_OTP_EACH=1 ./scripts/unpublish-all-packages.sh
```

See [npm 2FA guide](https://docs.npmjs.com/about-two-factor-authentication) and [npm unpublish policy](https://docs.npmjs.com/policies/unpublish). Expect **~24 h** before you can publish the same names again if all versions were removed.

## Security reminder

If a token was ever exposed, **revoke it immediately** in npm account settings and create a new token. Treat tokens like passwords.
