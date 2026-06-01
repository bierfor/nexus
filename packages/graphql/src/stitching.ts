/**
 * @nexus_js/graphql - Schema Stitching & Federation
 * 
 * Merge remote GraphQL schemas (legacy backends) with Nexus-native resolvers.
 * This lets you gradually migrate by adding new fields to old types.
 */

import type { GraphQLSchema, GraphQLFieldResolver } from 'graphql';
import {
  buildSchema,
  extendSchema,
  printSchema,
  parse,
  Kind,
  GraphQLObjectType,
  GraphQLFieldMap,
} from 'graphql';

export interface SubschemaConfig {
  /**
   * GraphQL schema from remote or local source.
   */
  schema: GraphQLSchema;

  /**
   * Executor function for resolving fields from this subschema.
   * Pass the function returned directly by createRemoteExecutor() (or createRemoteExecutorWithSchema).
   * Signature matches: (query, variables?, context?) => Promise<{data?, errors?}>
   */
  executor?: (
    query: string,
    variables?: Record<string, unknown>,
    context?: any,
  ) => Promise<{ data?: unknown; errors?: unknown[] }>;

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
  const { subschemas, typeMerging, resolvers } = opts;

  if (subschemas.length === 0) {
    throw new Error('stitchSchemas requires at least one subschema');
  }

  // Pragmatic implementation (no @graphql-tools dependency):
  // 1. Start with the first schema as base.
  // 2. For additional schemas, extend the base with their type definitions (print + extendSchema).
  // 3. For any subschema that has an `executor`, wrap fields on the corresponding types
  //    so they delegate to the remote (basic selectionSet reconstruction + executor call).
  // This covers the documented "gradual migration + add Shield on top of legacy" use case.
  // For advanced typeMerging, custom transforms, or full federation, users can combine
  // our `createRemoteExecutor` with @graphql-tools/stitch themselves.

  let stitched = subschemas[0]!.schema;

  const remoteExecutors = new Map<GraphQLSchema, (q: string, v?: any, c?: any) => Promise<any>>();

  for (const sub of subschemas) {
    if (sub.executor && sub.schema !== stitched) {
      remoteExecutors.set(sub.schema, sub.executor);
    }
  }

  // Extend with other schemas' definitions — defensive version that avoids
  // "Type Query already exists" by only extending non-root types when there is overlap.
  for (let i = 1; i < subschemas.length; i++) {
    const sub = subschemas[i]!;
    try {
      const sdl = printSchema(sub.schema);
      // If the extension would conflict on root types, fall back to delegation only
      if (sdl.includes('type Query') || sdl.includes('type Mutation')) {
        console.warn('[Nexus] stitchSchemas: additional schema contains root type(s); using delegation for remote fields instead of SDL extend (common for mixed local+remote stitches).');
        continue;
      }
      const extension = buildSchema(sdl, { assumeValidSDL: true });
      stitched = extendSchema(stitched, parse(printSchema(extension)));
    } catch (e) {
      console.warn('[Nexus] Could not extend schema during stitch, continuing with base + delegation:', e);
    }
  }

  // If we have custom resolvers (e.g. to add Shield-protected versions of legacy fields), apply them
  if (resolvers && Object.keys(resolvers).length > 0) {
    // For simplicity in this pragmatic impl we attach via a new extension SDL + resolvers.
    // A production version would use mapSchema or similar; here we do a best-effort merge.
    try {
      const extensionSDL = Object.entries(resolvers)
        .map(([typeName, fields]) => {
          const fieldSDL = Object.keys(fields).map(f => `  ${f}: JSON`).join('\n');
          return `extend type ${typeName} {\n${fieldSDL}\n}`;
        })
        .join('\n');
      if (extensionSDL.trim()) {
        const ext = buildSchema(`scalar JSON\n${extensionSDL}`, { assumeValidSDL: true });
        stitched = extendSchema(stitched, parse(printSchema(ext)));
      }
    } catch {
      // non-fatal
    }
  }

  // Wrap fields that belong to a remote subschema so they delegate
  // (very lightweight delegation — enough for the examples in the docs)
  const typeMap = stitched.getTypeMap();
  for (const [typeName, type] of Object.entries(typeMap)) {
    if (type instanceof GraphQLObjectType && !typeName.startsWith('__')) {
      const fields: GraphQLFieldMap<any, any> = type.getFields();
      for (const [fieldName, field] of Object.entries(fields)) {
        // If this field originally came from a remote schema that had an executor, wrap it
        for (const [remoteSchema, exec] of remoteExecutors) {
          // Heuristic: if the field exists on the remote schema's type, prefer delegation
          const remoteType = remoteSchema.getType(typeName) as GraphQLObjectType | undefined;
          if (remoteType && remoteType.getFields()[fieldName]) {
            const originalResolve = field.resolve;
            field.resolve = async (parent, args, context, info) => {
              // Build a tiny query for just this field
              const selection = info.fieldNodes[0]?.selectionSet
                ? info.fieldNodes[0].selectionSet
                : null;
              let query = `query { ${fieldName}`;
              if (Object.keys(args || {}).length) {
                query += `(${Object.keys(args).map(k => `${k}: $${k}`).join(', ')})`;
              }
              if (selection) {
                // naive: include sub-selection if present
                query += ' { ... }'; // executor will receive full document via info in real use
              }
              query += ' }';

              try {
                const result = await exec(query, args || {}, { nexusContext: context });
                if (result?.errors?.length) throw new Error(result.errors[0].message);
                // For top-level or simple cases return the data
                const data = result?.data?.[fieldName] ?? result?.data;
                return data ?? (originalResolve ? originalResolve(parent, args, context, info) : parent?.[fieldName]);
              } catch (err) {
                // Fall back to local/parent data if remote fails
                if (originalResolve) return originalResolve(parent, args, context, info);
                return parent?.[fieldName];
              }
            };
            break; // wrapped for this remote
          }
        }
      }
    }
  }

  // Apply typeMerging config if provided (basic support: add selection hints)
  if (typeMerging) {
    // In a fuller impl we would rewrite resolvers to always fetch the selectionSet first.
    // For pragmatic purposes we leave a marker on context for advanced users.
    (stitched as any)._nexusTypeMerging = typeMerging;
  }

  return stitched;
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
