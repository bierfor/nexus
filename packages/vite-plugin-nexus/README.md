# vite-plugin-nexus

Official Vite plugin for Nexus — transforms .nx files, HMR, island manifests, Server Actions.

## Documentation

All guides, API reference, and examples live on **[nexusjs.dev](https://nexusjs.dev)**.

### Scoped CSS HMR (Vite dev)

When you save a `.nx` file that contains a `<style>` block, the plugin:

1. Recompiles on the server and emits a Vite custom event `nexus:style-update` with `{ hash, css, filepath }` — `hash` is `componentHash(filepath)` and matches `[data-nx="…"]` in the compiled template.
2. Injects a small client bridge (via `index.html` in dev) that listens on `import.meta.hot` and updates or appends `<style data-nx-style-scope="…">` so styles can refresh without a full page reload. Runes / island state stay warm when the rest of the pipeline cooperates.

Disable automatic injection with `nexus({ styleBridge: false })` and import `virtual:nexus-style-bridge` yourself if you prefer.

## Links

- **Website:** [https://nexusjs.dev](https://nexusjs.dev)
- **Repository:** [github.com/bierfor/nexus](https://github.com/bierfor/nexus) (see `packages/vite-plugin-nexus/`)
- **Issues:** [github.com/bierfor/nexus/issues](https://github.com/bierfor/nexus/issues)

## License

MIT © Nexus contributors
