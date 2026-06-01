# @nexus_js/graphql

Security-first GraphQL adapter for Nexus.js.

Provides a Web-standard `(Request, NexusContext) => Promise<Response>` handler that integrates seamlessly with Nexus mounts, plus production-grade Shield (complexity/depth analysis), field masking, Vault-backed JWT, DataLoader, and legacy-bridge tools.

## Quick Start

```ts
import { createGraphQLHandler, createBatchLoader, createJwtService } from '@nexus_js/graphql';
import { nexusVault } from '@nexus_js/security';
import { schema } from './graphql/schema.js';

const jwtSvc = createJwtService(nexusVault, { vaultKey: 'JWT_SECRET', issuer: 'my-app' });

const handler = createGraphQLHandler({
  schema,
  dev: process.env.NODE_ENV !== 'production',
  shield: { maxCost: 500, maxDepth: 8, allowIntrospection: false },
  mask: { 'User.passwordHash': null },
  context: (req, ctx) => ({
    ...ctx,
    user: jwtSvc.verify(req.headers.get('authorization')?.replace('Bearer ', '') ?? ''),
    loaders: { user: createBatchLoader(ids => db.users.findMany(ids)) },
  }),
});

// In your Nexus server config or route
export default {
  server: {
    mounts: [{ path: '/graphql', handler }],
  },
};
```

## Exports

- `createGraphQLHandler` + types (`GraphQLHandlerOptions`, CORS, rate limit, etc.)
- Shield: `analyseComplexity`, `maskResult`, `allowWhen`, `redactUnless`
- JWT + hot-rotating Vault: `createJwtService`, `signJwt`, `verifyJwt`
- N+1 prevention: `createBatchLoader`, `BatchLoader`, `createLoaderRegistry`
- Legacy Bridge (pragmatic):
  - `createRemoteExecutor` — robust proxy with batching, retry, transforms, auth forwarding
  - `createRemoteExecutorWithSchema` — introspection + real `buildClientSchema` result
  - `stitchSchemas` — local schema merge + basic remote delegation via executors
  - `createGatewayResolver` — simple multi-service routing

See the root [README.md](../../README.md) Legacy Bridge section and the package source for detailed examples.

## Legacy Bridge Status (0.9.22+)

`createRemoteExecutor` (with batching) and the handler + Shield layers are production-ready.

`createRemoteExecutorWithSchema` now returns a usable schema.

`stitchSchemas` provides practical merging for the common "add Nexus fields/security on top of legacy" use case. For very advanced type merging, custom transforms, or federation, we recommend using the executors we provide together with `@graphql-tools/stitch` (or Apollo Federation) in your own code — our primitives are designed to be compatible.

## Links

- **Website:** [https://nexusjs.dev](https://nexusjs.dev)
- **Repository:** [github.com/bierfor/nexus](https://github.com/bierfor/nexus) (see `packages/graphql/`)
- **Issues:** [github.com/bierfor/nexus/issues](https://github.com/bierfor/nexus/issues)

## License

MIT © Nexus contributors
