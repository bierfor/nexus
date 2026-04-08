/**
 * Nexus GraphQL Field Masking
 *
 * Intercepts GraphQL execution results *after* resolution to null-out or
 * redact fields the caller is not authorised to see.
 *
 * This is a last-resort defence layer — it does NOT replace resolver-level
 * auth guards. Its purpose:
 *  - Prevent accidental secret leakage when a resolver returns a full DB row
 *  - Mask PII in logs / analytics pipelines without modifying every resolver
 *  - Provide a single policy source-of-truth instead of scattered checks
 *
 * Usage
 * ─────
 *  const policy: MaskPolicy = {
 *    'User.passwordHash': 'REDACTED',
 *    'User.apiKey':       (value, ctx) => ctx.user?.role === 'admin' ? value : '••••••••',
 *    'PaymentMethod.cvv': null,
 *  };
 *
 *  const masked = maskResult(result, policy, gqlCtx);
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Called when a masked field is accessed.
 * Return the replacement value (or null/undefined to strip the field).
 * `rawValue` is the resolved value before masking.
 * `ctx` is whatever context you passed to `maskResult`.
 */
export type MaskFn<Ctx = unknown> = (rawValue: unknown, ctx: Ctx) => unknown;

/**
 * Policy map: key is "TypeName.fieldName" or just "fieldName" (matches any type).
 * Value is either:
 *   - A static replacement  (string, number, null, undefined …)
 *   - A `MaskFn` for dynamic decisions (e.g. role-based access)
 */
export type MaskPolicy<Ctx = unknown> = Record<string, unknown | MaskFn<Ctx>>;

export interface GraphQLExecutionResult {
  data?:   Record<string, unknown> | null;
  errors?: Array<{ message: string; [key: string]: unknown }>;
  extensions?: Record<string, unknown>;
}

// ── Core masking ─────────────────────────────────────────────────────────────

/**
 * Walk the GraphQL execution result and apply the mask policy.
 * Returns a new result object — the original is never mutated.
 *
 * @param result   Raw result from `graphql.execute()`
 * @param policy   Field masking policy
 * @param ctx      Arbitrary context forwarded to MaskFn handlers
 * @param typePath Current object type path for nested resolution (internal use)
 */
export function maskResult<Ctx = unknown>(
  result: GraphQLExecutionResult,
  policy: MaskPolicy<Ctx>,
  ctx: Ctx,
): GraphQLExecutionResult {
  if (!result.data) return result;
  return {
    ...result,
    data: maskValue(result.data, '__ROOT__', policy, ctx) as Record<string, unknown>,
  };
}

// ── Internal walker ─────────────────────────────────────────────────────────

function maskValue<Ctx>(
  value:    unknown,
  typePath: string,
  policy:   MaskPolicy<Ctx>,
  ctx:      Ctx,
): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(item => maskValue(item, typePath, policy, ctx));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Detect GraphQL __typename for type-aware masking
    const typeName: string = typeof obj['__typename'] === 'string'
      ? obj['__typename']
      : typePath;

    const masked: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      // Build lookup keys: "TypeName.fieldName" first, then bare "fieldName"
      const qualifiedKey = `${typeName}.${key}`;
      const hasMasked    = qualifiedKey in policy || key in policy;

      if (hasMasked) {
        const policyEntry = qualifiedKey in policy ? policy[qualifiedKey] : policy[key];
        if (typeof policyEntry === 'function') {
          masked[key] = (policyEntry as MaskFn<Ctx>)(val, ctx);
        } else {
          masked[key] = policyEntry;
        }
      } else {
        // Recurse into nested objects — pass the field name as a type hint
        // (if the nested object has __typename we'll pick it up there)
        masked[key] = maskValue(val, key, policy, ctx);
      }
    }
    return masked;
  }

  return value;
}

// ── Helper: build a role-based mask function ─────────────────────────────────

/**
 * Convenience factory: returns null when `guardFn` returns false, otherwise
 * passes the raw value through unchanged.
 *
 * @example
 *   'User.apiKey': allowWhen((ctx: MyCtx) => ctx.user?.role === 'admin')
 */
export function allowWhen<Ctx>(
  guardFn: (ctx: Ctx, rawValue: unknown) => boolean,
): MaskFn<Ctx> {
  return (rawValue, ctx) => (guardFn(ctx, rawValue) ? rawValue : null);
}

/**
 * Convenience factory: return `replacement` when the guard fails.
 *
 * @example
 *   'User.email': redactUnless((ctx: MyCtx) => ctx.user?.id === ctx.vars?.userId, '***@***.***')
 */
export function redactUnless<Ctx>(
  guardFn:     (ctx: Ctx, rawValue: unknown) => boolean,
  replacement: unknown = 'REDACTED',
): MaskFn<Ctx> {
  return (rawValue, ctx) => (guardFn(ctx, rawValue) ? rawValue : replacement);
}
