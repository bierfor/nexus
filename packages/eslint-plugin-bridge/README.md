# @nexus_js/eslint-plugin-bridge

ESLint rules for Nexus Bridge tenancy isolation.

## Install

```bash
pnpm add -D eslint @nexus_js/eslint-plugin-bridge
```

## Usage

In your ESLint config:

```js
import bridge from '@nexus_js/eslint-plugin-bridge'

export default [
  {
    plugins: { bridge },
    rules: {
      'bridge/require-with-tenant': 'error',
    },
  },
]
```

## Rules

- `bridge/require-with-tenant`: requires `ctx.db.*(...)` calls to wrap the first argument with `withTenant(ctx, ...)`.
