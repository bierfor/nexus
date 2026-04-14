import type { CanonicalEntity, CanonicalModel } from './types.js';

function pascal(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .split('_')
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function toGraphqlScalar(dbType: string): string {
  const t = dbType.toLowerCase();
  if (t.includes('int') || t === 'serial' || t === 'bigserial') return 'Int';
  if (t.includes('bool')) return 'Boolean';
  if (t.includes('uuid')) return 'ID';
  if (t.includes('json')) return 'JSON';
  if (t.includes('timestamp') || t.includes('date') || t.includes('time')) return 'String';
  if (t.includes('numeric') || t.includes('decimal') || t.includes('double') || t.includes('real')) return 'Float';
  return 'String';
}

function fieldToSdlType(field: CanonicalEntity['fields'][number]): string {
  const base = field.type.dbType ? toGraphqlScalar(field.type.dbType) : 'String';
  return field.nullable ? base : `${base}!`;
}

function entityTypeSdl(entity: CanonicalEntity): string {
  const typeName = pascal(entity.name);
  const fields = entity.fields
    .filter(f => f.sensitivity !== 'secret')
    .map(f => `  ${f.name}: ${fieldToSdlType(f)}`)
    .join('\n');
  return `type ${typeName} {\n${fields}\n}`;
}

function querySdl(entities: CanonicalEntity[]): string {
  const fields = entities
    .filter(e => e.kind === 'table' || e.kind === 'view')
    .map((e) => {
      const typeName = pascal(e.name);
      return [
        `  list${typeName}(limit: Int = 50, offset: Int = 0): [${typeName}!]!`,
        e.primaryKey.length === 1 ? `  get${typeName}(id: ID!): ${typeName}` : null,
      ].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n');
  return `type Query {\n  health: String!\n${fields ? fields + '\n' : ''}}`;
}

export function generateGraphqlSdl(model: CanonicalModel): string {
  const header = 'scalar JSON';
  const types = model.entities.map(entityTypeSdl).join('\n\n');
  const query = querySdl(model.entities);
  return `${header}\n\n${types}\n\n${query}\n`;
}

export interface GeneratedFile {
  relativePath: string;
  content: string;
}

export function generateAppFiles(model: CanonicalModel): GeneratedFile[] {
  const sdl = generateGraphqlSdl(model);
  const tenantKey = model.tenancy.key?.type === 'field' ? model.tenancy.key.value : 'tenant_id';
  const safeTenantKey = tenantKey === '__proto__' || tenantKey === 'prototype' || tenantKey === 'constructor' ? 'tenant_id' : tenantKey;
  const secureQuery = `export const BRIDGE_TENANT_KEY = ${JSON.stringify(safeTenantKey)};\n\nexport function secureQuery<T extends { where?: Record<string, unknown> }>(ctx: { locals?: Record<string, unknown> }, query: T): T {\n  const tenantId = String((ctx.locals?.tenantId ?? (ctx.locals as any)?.tenant?.id) ?? '').trim();\n  if (!tenantId) return query;\n  const where = (query.where && typeof query.where === 'object') ? query.where : {};\n  return {\n    ...query,\n    where: {\n      ...where,\n      [BRIDGE_TENANT_KEY]: tenantId,\n    },\n  };\n}\n`;
  const mount = `import { createGraphQLHandler } from '@nexus_js/graphql';\nimport type { NexusContext } from '@nexus_js/server';\nimport { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLNonNull } from 'graphql';\n\nfunction makeSchema(): GraphQLSchema {\n  return new GraphQLSchema({\n    query: new GraphQLObjectType({\n      name: 'Query',\n      fields: {\n        health: { type: new GraphQLNonNull(GraphQLString), resolve: () => 'ok' },\n      },\n    }),\n  });\n}\n\nexport function createBridgeGraphQLMount() {\n  const schema = makeSchema();\n  return createGraphQLHandler({\n    schema,\n    shield: {\n      allowIntrospection: false,\n      maxDepth: ${model.security.shieldDefaults.maxDepth},\n      maxComplexity: ${model.security.shieldDefaults.maxComplexity},\n    },\n    maxBodyBytes: ${model.security.shieldDefaults.maxBodyBytes},\n    rateLimit: { max: ${model.security.shieldDefaults.rateLimit.max}, windowMs: ${model.security.shieldDefaults.rateLimit.windowMs} },\n    context: async (_req, nexusCtx: NexusContext) => nexusCtx,\n  });\n}\n`;
  const readme = `Nexus Bridge\n\nGenerated files:\n- nexus/bridge/canonical-model.json\n- nexus/bridge/security-report.json\n- nexus/bridge/schema.graphql\n\nSecurity notes:\n- Secret fields are excluded from the generated SDL.\n- Keep Shield enabled and add masking rules for pii fields.\n`;
  return [
    { relativePath: 'nexus/bridge/schema.graphql', content: sdl },
    { relativePath: 'src/mounts/graphql.ts', content: mount },
    { relativePath: 'src/bridge/secure-query.ts', content: secureQuery },
    { relativePath: 'nexus/bridge/README.md', content: readme },
  ];
}
