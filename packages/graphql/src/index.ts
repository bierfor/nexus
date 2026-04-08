/**
 * @nexus_js/graphql — GraphQL integration for Nexus.js
 *
 * Provides a security-first GraphQL adapter that integrates with the Nexus
 * server pipeline without Express, without CORS conflicts, and without
 * external runtime dependencies beyond `graphql` itself.
 *
 * Quick-start
 * ───────────
 *  ```ts
 *  // nexus.config.ts or server startup
 *  import { createGraphQLHandler, createBatchLoader, createJwtService } from '@nexus_js/graphql';
 *  import { nexusVault } from '@nexus_js/security';
 *  import { schema } from './graphql/schema.js';
 *
 *  const jwtSvc = createJwtService(nexusVault, { vaultKey: 'JWT_SECRET', issuer: 'my-app' });
 *
 *  const gqlHandler = createGraphQLHandler({
 *    schema,
 *    dev:    process.env.NODE_ENV !== 'production',
 *    cors:   { origins: ['https://app.example.com'], credentials: true },
 *    shield: { maxCost: 500, maxDepth: 8, allowIntrospection: false },
 *    mask:   { 'User.passwordHash': null, 'PaymentCard.cvv': 'REDACTED' },
 *    context: (req, ctx) => ({
 *      ...ctx,
 *      user:    jwtSvc.verify(req.headers.get('authorization')?.replace('Bearer ', '') ?? ''),
 *      loaders: { user: createBatchLoader(ids => db.users.findMany(ids)) },
 *    }),
 *  });
 *
 *  // Add to createNexusServer:
 *  mounts: [{ path: '/graphql', handler: gqlHandler }]
 *  ```
 *
 * Architecture
 * ────────────
 *  Handler pipeline per request:
 *  1. CORS preflight (OPTIONS) → 204 with Access-Control headers
 *  2. GraphiQL HTML (dev GET with Accept: text/html)
 *  3. Rate limiting (sliding window, per IP)
 *  4. Parse GET/POST JSON/application/graphql body
 *  5. graphql.parse() + graphql.validate()
 *  6. Shield: complexity + depth + introspection gate
 *  7. Context factory call
 *  8. graphql.execute()
 *  9. Field masking
 * 10. JSON response
 */

// ── Handler ──────────────────────────────────────────────────────────────────
export {
  createGraphQLHandler,
  type GraphQLHandlerOptions,
  type CorsConfig,
  type GraphQLContextFn,
  type MinimalNexusContext,
  type RateLimitPerOperation,
} from './handler.js';

// ── Complexity Shield ─────────────────────────────────────────────────────────
export {
  analyseComplexity,
  type ComplexityConfig,
  type ComplexityResult,
} from './complexity.js';

// ── Field masking ─────────────────────────────────────────────────────────────
export {
  maskResult,
  allowWhen,
  redactUnless,
  type MaskPolicy,
  type MaskFn,
  type GraphQLExecutionResult,
} from './mask.js';

// ── JWT + Vault rotation ──────────────────────────────────────────────────────
export {
  createJwtService,
  signJwt,
  verifyJwt,
  type JwtService,
  type JwtServiceOptions,
  type JwtPayload,
} from './jwt.js';

// ── DataLoader (N+1 prevention) ───────────────────────────────────────────────
export {
  BatchLoader,
  createBatchLoader,
  createLoaderRegistry,
  type BatchFn,
  type BatchLoaderOptions,
} from './dataloader.js';

// ── Legacy Bridge: Remote executor & stitching ────────────────────────────────
export {
  createRemoteExecutor,
  createRemoteExecutorWithSchema,
  type RemoteExecutorOptions,
  type RemoteExecutionContext,
  type RemoteExecutionResult,
} from './remote-executor.js';

export {
  stitchSchemas,
  createGatewayResolver,
  type SubschemaConfig,
  type StitchSchemasOptions,
} from './stitching.js';
