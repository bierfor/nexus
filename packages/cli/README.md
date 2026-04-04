# Nexus CLI (`nexus`, `create-nexus`)

Command-line tools for [Nexus](https://nexusjs.dev) — the full-stack web framework with islands architecture, Svelte 5 runes, and server actions.

- **Documentation:** [https://nexusjs.dev](https://nexusjs.dev)  
- **Repository:** [github.com/bierfor/nexus](https://github.com/bierfor/nexus)  
- **Issues:** [github.com/bierfor/nexus/issues](https://github.com/bierfor/nexus/issues)

## Install

```bash
pnpm add -D @nexus_js/cli
# or
npm install -D @nexus_js/cli
```

Global install (optional):

```bash
npm install -g @nexus_js/cli
```

## Commands

| Command | Description |
|--------|-------------|
| `nexus dev` | Start the development server with HMR |
| `nexus build` | Production build |
| `nexus start` | Run the production server |
| `nexus studio` | Open Nexus Studio (dev dashboard) |
| `nexus routes` | Print the route manifest |
| `nexus check` | TypeScript check |
| `create-nexus <name>` | Scaffold a new project |

## New project

**Recommended** (works as long as `@nexus_js/cli` is on npm):

```bash
npm exec --package=@nexus_js/cli@latest -- create-nexus my-app
```

```bash
pnpm dlx --package=@nexus_js/cli@latest create-nexus my-app
```

Shorthand `pnpm create @nexus_js/nexus` needs **`@nexus_js/create-nexus`** published; if you get **404**, use the commands above.

After `@nexus_js/create-nexus` exists on npm:

```bash
npm create @nexus_js/nexus@latest my-app
```

```bash
pnpm create @nexus_js/nexus my-app
```

```bash
npx @nexus_js/create-nexus@latest my-app
```

```bash
npm install -g @nexus_js/cli
create-nexus my-app
```

See the [full documentation](https://nexusjs.dev) for configuration, routing, `.nx` components, and deployment.

## License

MIT © Nexus contributors
