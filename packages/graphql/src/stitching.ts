/**
 * @nexus_js/graphql - Schema Stitching & Federation
 * 
 * Merge remote GraphQL schemas (legacy backends) with Nexus-native resolvers.
 * This lets you gradually migrate by adding new fields to old types.
 */

import type { GraphQLSchema, GraphQLFieldResolver } from 'graphql';

export interface SubschemaConfig {
  /**
   * GraphQL schema from remote or local source.
   */
  schema: GraphQLSchema;

  /**
   * Executor function for resolving fields from this subschema.
   * For remote schemas, use createRemoteExecutor().
   */
  executor?: (opts: {
    document: string;
    variables?: Record<string, unknown>;
    context?: unknown;
  }) => Promise<{ data?: unknown; errors?: unknown[] }>;

  /**
   * Transforms to apply to this subschema before merging.
   */
  transforms?: Array<{
    transformSchema?: (schema: GraphQLSchema) => GraphQLSchema;
    transformRequest?: (request: unknown) => unknown;
    transformResult?: (result: unknown) => unknown;
  }>;

  /**
   * Batch configuration for this subschema.
   */
  batch?: boolean;
}

export interface StitchSchemasOptions {
  /**
   * Array of subschemas to merge.
   * Each can be a local Nexus schema or a remote legacy schema.
   */
  subschemas: SubschemaConfig[];

  /**
   * Type merging configuration.
   * Allows multiple subschemas to contribute fields to the same type.
   * 
   * @example
   * ```ts
   * typeMerging: {
   *   User: {
   *     // If User exists in both schemas, merge their fields
   *     selectionSet: '{ id }',
   *     fieldName: 'user',
   *     args: (obj) => ({ id: obj.id }),
   *   }
   * }
   * ```
   */
  typeMerging?: Record<
    string,
    {
      selectionSet: string;
      fieldName: string;
      args?: (obj: unknown) => Record<string, unknown>;
    }
  >;

  /**
   * Resolvers to add or override in the stitched schema.
   * Use this to add Nexus-specific business logic on top of legacy fields.
   */
  resolvers?: Record<string, Record<string, GraphQLFieldResolver<unknown, unknown>>>;

  /**
   * Schema directives to add to the stitched schema.
   */
  schemaDirectives?: Record<string, unknown>;
}

/**
 * Stitch multiple GraphQL schemas into one unified schema.
 * 
 * This is the core of Nexus's "Legacy Bridge" feature.
 * You can combine:
 * - Remote schemas from old backends (via createRemoteExecutor)
 * - Local Nexus schemas with Shield/Vault integration
 * - New resolvers that add security to legacy fields
 * 
 * @example
 * ```ts
 * import { stitchSchemas } from '@nexus_js/graphql';
 * import { createRemoteExecutor } from '@nexus_js/graphql';
 * 
 * const legacyExecutor = createRemoteExecutor({
 *   url: 'https://old-api.example.com/graphql',
 * });
 * 
 * const { executor: legacyExec, schema: legacySchema } = 
 *   await createRemoteExecutorWithSchema({ url: '...' });
 * 
 * const stitched = stitchSchemas({
 *   subschemas: [
 *     { schema: legacySchema, executor: legacyExec },
 *     { schema: nexusSchema },
 *   ],
 *   typeMerging: {
 *     User: {
 *       selectionSet: '{ id }',
 *       fieldName: 'user',
 *       args: (obj) => ({ id: obj.id }),
 *     }
 *   },
 *   resolvers: {
 *     User: {
 *       // Add Shield protection to legacy User.apiKey field
 *       apiKey: async (parent, args, context) => {
 *         if (context.user?.role !== 'admin') return null;
 *         return parent.apiKey; // Delegate to legacy
 *       }
 *     }
 *   }
 * });
 * ```
 */
export function stitchSchemas(opts: StitchSchemasOptions): GraphQLSchema {
  const { subschemas, typeMerging, resolvers, schemaDirectives } = opts;

  // PLACEHOLDER IMPLEMENTATION
  // Full implementation would use @graphql-tools/stitch or similar
  // For now, return a mock schema to show intent

  console.warn(
    '[Nexus] Schema stitching requires @graphql-tools/stitch. Install it separately:',
    'npm install @graphql-tools/stitch @graphql-tools/delegate',
  );

  // Return first schema as fallback
  if (subschemas.length === 0) {
    throw new Error('stitchSchemas requires at least one subschema');
  }

  // TODO: Implement full stitching logic with type merging
  // This would involve:
  // 1. Merging type definitions from all subschemas
  // 2. Creating delegating resolvers for remote fields
  // 3. Applying transforms and type merging config
  // 4. Adding custom resolvers on top

  return subschemas[0]!.schema;
}

/**
 * Helper to create a "gateway" resolver that delegates to multiple backends.
 * 
 * Use this when you want Nexus to act as a unified API gateway
 * that routes requests to different legacy services.
 * 
 * @example
 * ```ts
 * const gateway = createGatewayResolver({
 *   services: {
 *     auth: createRemoteExecutor({ url: 'http://auth.internal/graphql' }),
 *     payments: createRemoteExecutor({ url: 'http://payments.internal/graphql' }),
 *   },
 *   routing: {
 *     'Query.user': 'auth',
 *     'Query.payment': 'payments',
 *   }
 * });
 * ```
 */
export function createGatewayResolver(opts: {
  services: Record<string, ReturnType<typeof import('./remote-executor').createRemoteExecutor>>;
  routing: Record<string, string>;
}): GraphQLFieldResolver<unknown, unknown> {
  const { services, routing } = opts;

  return async function gatewayResolver(parent, args, context, info) {
    const fieldKey = `${info.parentType.name}.${info.fieldName}`;
    const serviceName = routing[fieldKey];

    if (!serviceName || !services[serviceName]) {
      throw new Error(`No service configured for ${fieldKey}`);
    }

    const executor = services[serviceName];
    const query = `
      query ${info.fieldName}($args: JSON) {
        ${info.fieldName}(args: $args)
      }
    `;

    const result = await executor(query, { args }, { nexusContext: context as Record<string, unknown> });

    if (result.errors && result.errors.length > 0) {
      throw new Error(result.errors[0]!.message);
    }

    return result.data;
  };
}
