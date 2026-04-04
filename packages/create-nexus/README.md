# @nexus_js/create-nexus

Official project scaffold for [Nexus](https://nexusjs.dev). Published under the **`@nexus_js`** scope so you can publish without fighting for the global name `create-nexus` on npm.

npm maps **`npm create @scope/name`** to the package **`@scope/create-name`**:

```bash
npm create @nexus_js/nexus@latest
```

```bash
pnpm create @nexus_js/nexus
```

```bash
yarn create @nexus_js/nexus
```

```bash
bunx @nexus_js/create-nexus@latest
```

With a folder name:

```bash
npm create @nexus_js/nexus@latest my-app
```

### Interactive setup (default in a terminal)

Running create without `--yes` starts a short wizard (similar to Next.js / Nuxt):

1. **Project directory** — folder name under the current path (default `my-nexus-app`, or the name you passed as the first argument).
2. **Starter** — **minimal** or **full** (unless you already passed `-t` / `--template`).
3. **Summary** — confirm with **Y** before files are written.

If the target folder already exists, the CLI exits with an error (no overwrite).

### Non-interactive / CI

Use **`--yes`** (or **`-y`**, **`--defaults`**) to skip all prompts:

- Directory: first positional argument, or `my-nexus-app`.
- Starter: **`--template`**, or **full** by default.

```bash
npm create @nexus_js/nexus@latest -- --yes
npx @nexus_js/create-nexus@latest ci-app --yes --template minimal
```

### Starter templates

| Template | Flag | What you get |
|----------|------|----------------|
| **Minimal** | `--template minimal` or `-t minimal` | One landing `+page.nx`, simple `+layout.nx`, no i18n, no example blog or `/islands` route — closest to a blank slate. |
| **Full** | `--template full` or `-t full` (default when non-interactive) | i18n (en/es/pt), islands presentation page, blog examples — same shape as the `my-nexus-app` reference in the repo. |

```bash
npm create @nexus_js/nexus@latest my-app -- --template minimal
```

```bash
npx @nexus_js/create-nexus@latest my-app -t full
```

Direct binary (same as above):

```bash
npx @nexus_js/create-nexus@latest my-app
```

Then:

```bash
cd my-app
npm install   # or: pnpm install / yarn / bun install
npm run dev     # or: pnpm dev / yarn dev / bun run dev
```

The implementation lives in **`@nexus_js/cli`**; this package only wires the **create** entrypoint.

## License

MIT © Nexus contributors
