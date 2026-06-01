/**
 * @nexus_js/graphql - Remote GraphQL Executor
 * 
 * Proxy to external GraphQL APIs with Nexus Shield integration.
 * Use this to migrate legacy backends gradually by fronting them with Nexus security.
 */

import type { GraphQLSchema, IntrospectionQuery } from 'graphql';
import { buildClientSchema } from 'graphql/utilities';

export interface RemoteExecutorOptions {
  /**
   * URL of the remote GraphQL endpoint.
   * @example 'https://legacy-api.example.com/graphql'
   */
  url: string;

  /**
   * Optional headers to include in every request.
   * Use for API keys or service-to-service auth.
   * @example { 'x-api-key': process.env.LEGACY_API_KEY }
   */
  headers?: Record<string, string>;

  /**
   * Timeout for remote requests in milliseconds.
   * @default 10000 (10 seconds)
   */
  timeoutMs?: number;

  /**
   * Whether to forward Authorization header from incoming request.
   * @default false
   */
  forwardAuth?: boolean;

  /**
   * Transform outgoing variables before sending to remote.
   * Use to rename fields or inject context.
   */
  transformVariables?: (variables: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Transform incoming result after receiving from remote.
   * Use to adapt legacy response format to Nexus conventions.
   */
  transformResult?: (result: unknown) => unknown;

  /**
   * Enable batching multiple operations into a single HTTP request.
   * @default false
   */
  batch?: boolean;

  /**
   * Retry failed requests (network errors, 5xx).
   * @default { attempts: 2, delayMs: 500 }
   */
  retry?: {
    attempts: number;
    delayMs: number;
  };
}

export interface RemoteExecutionContext {
  /**
   * Nexus context from the incoming request.
   */
  nexusContext?: Record<string, unknown>;

  /**
   * Custom headers to merge with executor defaults.
   */
  headers?: Record<string, string>;

  /**
   * Override timeout for this specific request.
   */
  timeoutMs?: number;
}

export interface RemoteExecutionResult<T = unknown> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>;
}

/**
 * Create a remote GraphQL executor that acts as a proxy to a legacy backend.
 * 
 * Nexus Shield and rate limiting are applied BEFORE forwarding the request.
 * This lets you add security to an insecure legacy API without modifying it.
 * 
 * @example
 * ```ts
 * import { createRemoteExecutor } from '@nexus_js/graphql';
 * 
 * const legacyApi = createRemoteExecutor({
 *   url: 'https://old-api.company.com/graphql',
 *   headers: { 'x-service-token': vault.get('LEGACY_TOKEN') },
 *   timeoutMs: 5000,
 *   forwardAuth: true,
 * });
 * 
 * // In resolver:
 * const result = await legacyApi(
 *   'query GetUser($id: ID!) { user(id: $id) { name email } }',
 *   { id: '123' },
 *   { nexusContext: ctx }
 * );
 * ```
 */
export function createRemoteExecutor(opts: RemoteExecutorOptions) {
  const {
    url,
    headers: defaultHeaders = {},
    timeoutMs: defaultTimeout = 10_000,
    forwardAuth = false,
    transformVariables,
    transformResult,
    batch = false,
    retry = { attempts: 2, delayMs: 500 },
  } = opts;

  // Batch queue for combining operations
  let batchQueue: Array<{
    query: string;
    variables: Record<string, unknown>;
    resolve: (result: RemoteExecutionResult) => void;
    reject: (error: Error) => void;
  }> = [];
  let batchTimer: NodeJS.Timeout | null = null;

  async function executeSingle(
    query: string,
    variables: Record<string, unknown>,
    context?: RemoteExecutionContext,
  ): Promise<RemoteExecutionResult> {
    const finalVariables = transformVariables ? transformVariables(variables) : variables;
    const timeout = context?.timeoutMs ?? defaultTimeout;

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...defaultHeaders,
      ...(context?.headers ?? {}),
    };

    // Forward Authorization if configured
    if (forwardAuth && context?.nexusContext) {
      const authHeader = (context.nexusContext as { request?: { headers?: Headers } })?.request
        ?.headers;
      if (authHeader) {
        const auth = authHeader.get('authorization');
        if (auth) reqHeaders['authorization'] = auth;
      }
    }

    const body = JSON.stringify({ query, variables: finalVariables });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < retry.attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers: reqHeaders,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Retry on 5xx
          if (response.status >= 500 && attempt < retry.attempts - 1) {
            await new Promise((r) => setTimeout(r, retry.delayMs));
            continue;
          }
          throw new Error(
            `Remote GraphQL returned ${response.status}: ${await response.text()}`,
          );
        }

        const json = (await response.json()) as RemoteExecutionResult;
        if (transformResult && json.data) {
          json.data = transformResult(json.data);
        }
        return json;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Retry on network errors
        if (attempt < retry.attempts - 1) {
          await new Promise((r) => setTimeout(r, retry.delayMs));
        }
      }
    }

    throw lastError ?? new Error('Remote execution failed');
  }

  async function flushBatch() {
    if (batchQueue.length === 0) return;
    const ops = [...batchQueue];
    batchQueue = [];

    try {
      // Build batch request (standard GraphQL batch format: array of { query, variables })
      const batchBody = ops.map((op) => ({
        query: op.query,
        variables: transformVariables ? transformVariables(op.variables) : op.variables,
      }));

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...defaultHeaders },
        body: JSON.stringify(batchBody),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.status}`);
      }

      const results = (await response.json()) as RemoteExecutionResult[];
      ops.forEach((op, i) => {
        const result = results[i];
        if (transformResult && result?.data) {
          result.data = transformResult(result.data);
        }
        op.resolve(result ?? { errors: [{ message: 'No result from batch' }] });
      });
    } catch (err) {
      ops.forEach((op) =>
        op.reject(err instanceof Error ? err : new Error(String(err))),
      );
    }
  }

  function executeBatched(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<RemoteExecutionResult> {
    return new Promise((resolve, reject) => {
      batchQueue.push({ query, variables, resolve, reject });

      if (!batchTimer) {
        batchTimer = setTimeout(() => {
          batchTimer = null;
          void flushBatch();
        }, 10); // 10ms batch window
      }
    });
  }

  return async function execute<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
    context?: RemoteExecutionContext,
  ): Promise<RemoteExecutionResult<T>> {
    if (batch && !context) {
      return executeBatched(query, variables) as Promise<RemoteExecutionResult<T>>;
    }
    return executeSingle(query, variables, context) as Promise<RemoteExecutionResult<T>>;
  };
}

/**
 * Create a remote executor with introspection to fetch the remote schema.
 * Useful for GraphQL schema stitching (federation).
 * 
 * @example
 * ```ts
 * const { executor, schema } = await createRemoteExecutorWithSchema({
 *   url: 'https://legacy.example.com/graphql',
 * });
 * 
 * // Use `schema` for stitching or merging with Nexus schema
 * const stitchedSchema = stitchSchemas({
 *   subschemas: [{ schema, executor }],
 * });
 * ```
 */
export async function createRemoteExecutorWithSchema(opts: RemoteExecutorOptions): Promise<{
  executor: ReturnType<typeof createRemoteExecutor>;
  schema: GraphQLSchema | null;
}> {
  const executor = createRemoteExecutor(opts);

  // Fetch introspection query
  const introspectionQuery = `
    query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        subscriptionType { name }
        types {
          ...FullType
        }
        directives {
          name
          description
          locations
          args {
            ...InputValue
          }
        }
      }
    }
    
    fragment FullType on __Type {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args {
          ...InputValue
        }
        type {
          ...TypeRef
        }
        isDeprecated
        deprecationReason
      }
      inputFields {
        ...InputValue
      }
      interfaces {
        ...TypeRef
      }
      enumValues(includeDeprecated: true) {
        name
        description
        isDeprecated
        deprecationReason
      }
      possibleTypes {
        ...TypeRef
      }
    }
    
    fragment InputValue on __InputValue {
      name
      description
      type { ...TypeRef }
      defaultValue
    }
    
    fragment TypeRef on __Type {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = await executor(introspectionQuery);
    if (result.errors) {
      console.warn('Remote introspection failed:', result.errors);
      return { executor, schema: null };
    }

    // Build real executable client schema from introspection
    try {
      const schema = buildClientSchema(result.data as IntrospectionQuery);
      return { executor, schema };
    } catch (buildErr) {
      console.warn('Failed to build client schema from introspection:', buildErr);
      return { executor, schema: null };
    }
  } catch (err) {
    console.warn('Failed to introspect remote schema:', err);
    return { executor, schema: null };
  }
}
