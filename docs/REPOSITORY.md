# Publishing a clean GitHub repository

This monorepo is intended to contain **only what ships or supports the Nexus framework**: `packages/`, `examples/`, `docs/`, workspace config, CI, and scripts. Personal apps (e.g. product demos under ignored paths) should stay **local** via root `.gitignore`.

## Before you push

1. **Secrets:** Never commit `.env`, `.env.local`, or API keys. They are listed in `.gitignore`.
2. **Install and verify** (Node **22+**, see **`.nvmrc`**):
   ```bash
   nvm use   # or fnm use
   pnpm install
   pnpm build
   pnpm test
   ```
3. **Optional:** Remove the old `origin` if you are replacing the remote:
   ```bash
   git remote remove origin
   ```

## Option A — New history (recommended for a “fresh” public repo)

Use this if you want a single clean initial commit without prior history.

```bash
cd /path/to/nexus
rm -rf .git
git init
git branch -M main
git add -A
git status   # confirm only intended paths are staged
git commit -m "chore: initial import of Nexus framework monorepo"
git remote add origin https://github.com/<org>/<repo>.git
git push -u origin main
```

## Option B — Keep git history, change remote

If you already cleaned the tree and only need to point to a **new** empty GitHub repository:

```bash
git remote remove origin
git remote add origin https://github.com/<org>/<repo>.git
git push -u origin main
```

## Deleting the old repository on GitHub

1. Open the repository on GitHub → **Settings**.
2. Scroll to **Danger Zone** → **Delete this repository**.
3. Create a **new** empty repository (same name is allowed after deletion delay, or use a new name).
4. Push using Option A or B above.

**Note:** Deleting a public repo frees the name only after GitHub’s retention rules; renaming the new repo is often simpler than waiting.

## What belongs in this repository

| Include | Reason |
|---------|--------|
| `packages/` | Published `@nexus_js/*` packages (incl. `@nexus_js/vite-plugin-nexus`) |
| `examples/` | Small demo apps wired in `pnpm-workspace.yaml` |
| `docs/` | In-repo technical docs and static assets (see **[`PRODUCTION.md`](./PRODUCTION.md)** for deploy / server-action hardening) |
| `.github/` | CI and templates |
| `scripts/` | Build, release, and tooling helpers |
| Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.npmrc` | Workspace bootstrap |

Paths such as `fin-sh/`, `mongo/`, `news/`, and `my-nexus-app/` are **gitignored** at the repository root so they are not pushed; keep them only on your machine or in separate repositories.

After you change the GitHub remote or organization, update **`repository`** and **`bugs`** URLs in each `packages/*/package.json` (and README links) so npm and the docs stay accurate.
