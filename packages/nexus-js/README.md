# nexus-js

Meta package for the [Nexus](https://nexusjs.dev) framework — **same as [`nexus_js`](https://www.npmjs.com/package/nexus_js)** (underscore). Pick whichever name is easier to type:

- **`nexus-js`** (hyphen) — `npm install nexus-js`
- **`nexus_js`** (underscore) — `npm install nexus_js`

Both depend on `@nexus_js/cli` and expose the **`nexus`** and **`create-nexus`** binaries.

## Install

```bash
npm install nexus-js
# or
pnpm add nexus-js
# or
bun add nexus-js
# or
yarn add nexus-js
```

Global CLI:

```bash
npm install -g nexus-js
nexus --version
create-nexus --help
```

## Direct scoped install (equivalent)

```bash
npm install @nexus_js/cli
```

App dependencies in a Nexus project use scoped packages (`@nexus_js/server`, `@nexus_js/runtime`, …). This package is only a convenient **unscoped** name for the CLI.
