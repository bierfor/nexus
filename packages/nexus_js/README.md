# nexus_js

Meta package for the [Nexus](https://nexusjs.dev) framework: it depends on `@nexus_js/cli` and exposes the same `nexus` and `create-nexus` binaries.

## Install

```bash
npm install nexus_js
# or
pnpm add nexus_js
# or
bun add nexus_js
# or
yarn add nexus_js
```

Global CLI:

```bash
npm install -g nexus_js
nexus --version
create-nexus --help
```

## Direct scoped install (equivalent)

```bash
npm install @nexus_js/cli
```

The scoped packages (`@nexus_js/server`, `@nexus_js/runtime`, …) are what your app depends on; this package is only a convenient unscoped name for the CLI.
