/**
 * Nexus GraphQL Complexity Shield
 *
 * Analyses the parsed GraphQL AST *before* execution to prevent:
 *
 *  1. Deep-nesting attacks  — a query like user { friends { friends { … } } }
 *     that reaches N levels can cause O(N) database round-trips.
 *
 *  2. Breadth/cost attacks — selecting 50 high-cost fields at once.
 *
 *  3. Introspection leaks  — schema exposure in production.
 *
 * Algorithm
 * ─────────
 *  For every FieldNode we add its `fieldCost` to the running total.
 *  If the field resolves to a list type we multiply children by `listMultiplier`
 *  (default 10) to model the N×M fan-out.
 *  Inline fragments and fragment spreads are expanded transparently.
 *  The visitor is purely synchronous (no I/O).
 *
 * Usage
 * ─────
 *  import { analyseComplexity } from '@nexus_js/graphql';
 *
 *  const { cost, depth, errors } = analyseComplexity(document, schema, {
 *    maxCost:  1000,
 *    maxDepth: 10,
 *    fieldCosts: { 'Query.analytics': 50, 'User.posts': 5 },
 *  });
 *  if (errors.length) return respondWithErrors(errors);
 */

import type {
  DocumentNode,
  FieldNode,
  InlineFragmentNode,
  FragmentSpreadNode,
  SelectionSetNode,
  GraphQLSchema,
  GraphQLOutputType,
  GraphQLObjectType,
} from 'graphql';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplexityConfig {
  /** Hard limit on total query cost. Default: 1000. */
  maxCost?: number;
  /** Hard limit on selection-set nesting depth. Default: 12. */
  maxDepth?: number;
  /**
   * Base cost multiplier for list fields (models N-row fan-out).
   * Default: 10. Set to 1 to disable.
   */
  listMultiplier?: number;
  /**
   * Per-field cost overrides. Key: "TypeName.fieldName" (e.g. "Query.analytics").
   * Default cost per field is 1.
   */
  fieldCosts?: Record<string, number>;
  /**
   * Allow introspection queries (__schema, __type, __typename).
   * Default: true (disable in production with false).
   */
  allowIntrospection?: boolean;
  /**
   * Per-operation-type limits override maxCost for mutations (which are often
   * more expensive than queries). Set to a lower number to tighten mutations.
   */
  mutationCostMultiplier?: number;
}

export interface ComplexityResult {
  cost: number;
  depth: number;
  /** Non-empty if any limit was exceeded. Pass these to GraphQL `errors` array. */
  errors: Array<{ message: string; extensions: { code: string } }>;
}

// ── Introspection field names ────────────────────────────────────────────────

const INTROSPECTION_FIELDS = new Set(['__schema', '__type', '__typename', '__typeName']);

// ── Core visitor ────────────────────────────────────────────────────────────

/**
 * Analyse a parsed GraphQL document against a schema.
 * Returns cost + depth + validation errors without executing anything.
 */
export function analyseComplexity(
  document: DocumentNode,
  schema: GraphQLSchema,
  config: ComplexityConfig = {},
): ComplexityResult {
  const {
    maxCost         = 1000,
    maxDepth        = 12,
    listMultiplier  = 10,
    fieldCosts      = {},
    allowIntrospection = true,
    mutationCostMultiplier = 1,
  } = config;

  const errors: ComplexityResult['errors'] = [];

  // Build named-fragment map for inline expansion
  const fragments = new Map<string, SelectionSetNode>();
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') {
      fragments.set(def.name.value, def.selectionSet);
    }
  }

  let globalMaxDepth = 0;
  let totalCost = 0;

  for (const def of document.definitions) {
    if (def.kind !== 'OperationDefinition') continue;

    const isMutation = def.operation === 'mutation';
    const costMul = isMutation ? mutationCostMultiplier : 1;
    const rootType = getOperationRootType(schema, def.operation);
    if (!rootType) continue;

    const { cost, depth } = visitSelectionSet(
      def.selectionSet,
      rootType,
      schema,
      fragments,
      fieldCosts,
      listMultiplier,
      0,
      allowIntrospection,
      errors,
    );

    totalCost += cost * costMul;
    if (depth > globalMaxDepth) globalMaxDepth = depth;
  }

  if (totalCost > maxCost) {
    errors.push({
      message: `Query complexity ${totalCost} exceeds maximum allowed cost of ${maxCost}.`,
      extensions: { code: 'COMPLEXITY_LIMIT_EXCEEDED' },
    });
  }

  if (globalMaxDepth > maxDepth) {
    errors.push({
      message: `Query depth ${globalMaxDepth} exceeds maximum allowed depth of ${maxDepth}.`,
      extensions: { code: 'DEPTH_LIMIT_EXCEEDED' },
    });
  }

  return { cost: totalCost, depth: globalMaxDepth, errors };
}

// ── Selection set visitor ────────────────────────────────────────────────────

interface VisitResult { cost: number; depth: number; }

function visitSelectionSet(
  selectionSet: SelectionSetNode,
  parentType: GraphQLObjectType,
  schema: GraphQLSchema,
  fragments: Map<string, SelectionSetNode>,
  fieldCosts: Record<string, number>,
  listMultiplier: number,
  currentDepth: number,
  allowIntrospection: boolean,
  errors: ComplexityResult['errors'],
): VisitResult {
  let cost  = 0;
  let depth = currentDepth;

  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const result = visitField(
        selection,
        parentType,
        schema,
        fragments,
        fieldCosts,
        listMultiplier,
        currentDepth,
        allowIntrospection,
        errors,
      );
      cost  += result.cost;
      if (result.depth > depth) depth = result.depth;

    } else if (selection.kind === 'InlineFragment') {
      const fragmentType = selection.typeCondition
        ? (schema.getType(selection.typeCondition.name.value) as GraphQLObjectType | undefined)
        : parentType;

      if (fragmentType && 'getFields' in fragmentType) {
        const result = visitSelectionSet(
          selection.selectionSet,
          fragmentType,
          schema,
          fragments,
          fieldCosts,
          listMultiplier,
          currentDepth,
          allowIntrospection,
          errors,
        );
        cost  += result.cost;
        if (result.depth > depth) depth = result.depth;
      }

    } else if (selection.kind === 'FragmentSpread') {
      const frag = fragments.get(selection.name.value);
      if (frag) {
        const result = visitSelectionSet(
          frag,
          parentType,
          schema,
          fragments,
          fieldCosts,
          listMultiplier,
          currentDepth,
          allowIntrospection,
          errors,
        );
        cost  += result.cost;
        if (result.depth > depth) depth = result.depth;
      }
    }
  }

  return { cost, depth };
}

function visitField(
  field: FieldNode,
  parentType: GraphQLObjectType,
  schema: GraphQLSchema,
  fragments: Map<string, SelectionSetNode>,
  fieldCosts: Record<string, number>,
  listMultiplier: number,
  currentDepth: number,
  allowIntrospection: boolean,
  errors: ComplexityResult['errors'],
): VisitResult {
  const fieldName = field.name.value;

  // Introspection gate
  if (INTROSPECTION_FIELDS.has(fieldName)) {
    if (!allowIntrospection) {
      errors.push({
        message: `Introspection is disabled in this environment.`,
        extensions: { code: 'INTROSPECTION_DISABLED' },
      });
    }
    return { cost: 0, depth: currentDepth };
  }

  const typeName = parentType.name;
  const costKey  = `${typeName}.${fieldName}`;
  const fieldCost = fieldCosts[costKey] ?? fieldCosts[fieldName] ?? 1;

  const thisDepth = currentDepth + 1;
  let cost  = fieldCost;
  let depth = thisDepth;

  if (field.selectionSet) {
    // Resolve the field's return type to determine multiplier
    const fieldDef = parentType.getFields()[fieldName];
    const isList   = fieldDef ? typeIsList(fieldDef.type) : false;
    const mul      = isList ? listMultiplier : 1;

    const childType = fieldDef
      ? namedObjectType(fieldDef.type, schema)
      : null;

    if (childType) {
      const childResult = visitSelectionSet(
        field.selectionSet,
        childType,
        schema,
        fragments,
        fieldCosts,
        listMultiplier,
        thisDepth,
        allowIntrospection,
        errors,
      );
      cost  += childResult.cost * mul;
      if (childResult.depth > depth) depth = childResult.depth;
    }
  }

  return { cost, depth };
}

// ── Schema helpers ───────────────────────────────────────────────────────────

function getOperationRootType(
  schema: GraphQLSchema,
  operation: string,
): GraphQLObjectType | undefined {
  switch (operation) {
    case 'query':        return schema.getQueryType()        ?? undefined;
    case 'mutation':     return schema.getMutationType()     ?? undefined;
    case 'subscription': return schema.getSubscriptionType() ?? undefined;
    default:             return undefined;
  }
}

/** Recursively unwrap NonNull/List wrappers to check if a list is present. */
function typeIsList(type: GraphQLOutputType): boolean {
  if ('ofType' in type && type.ofType != null) {
    if ((type as { kind?: string }).kind === 'LIST') return true;
    return typeIsList(type.ofType as GraphQLOutputType);
  }
  return false;
}

/**
 * Unwrap NonNull / List wrappers to reach the named ObjectType (if any).
 * Returns null for scalars, enums, unions, interfaces.
 */
function namedObjectType(
  type: GraphQLOutputType,
  schema: GraphQLSchema,
): GraphQLObjectType | null {
  // Unwrap wrappers
  let t: GraphQLOutputType = type;
  while ('ofType' in t && t.ofType != null) {
    t = t.ofType as GraphQLOutputType;
  }
  // Named type lookup
  if ('name' in t) {
    const named = schema.getType((t as { name: string }).name);
    if (named && 'getFields' in named) return named as GraphQLObjectType;
  }
  return null;
}
