import type { CanonicalEntity, CanonicalField, CanonicalModel, CanonicalRelation, CanonicalSecurity, CanonicalTenancy } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new Error(`[Bridge] Expected string at ${path}`);
  return v;
}

function asNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`[Bridge] Expected number at ${path}`);
  return v;
}

function asBool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`[Bridge] Expected boolean at ${path}`);
  return v;
}

function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`[Bridge] Expected array at ${path}`);
  return v;
}

function assertSafeIdent(name: string, path: string): void {
  if (!name || name.length > 128) throw new Error(`[Bridge] Invalid identifier at ${path}`);
  if (name.includes('\0') || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`[Bridge] Unsafe identifier at ${path}`);
  }
}

function parseTenancy(v: unknown, path: string): CanonicalTenancy {
  if (!isRecord(v)) throw new Error(`[Bridge] Expected object at ${path}`);
  const mode = asString(v['mode'], `${path}.mode`) as CanonicalTenancy['mode'];
  if (!['single', 'subdomain', 'path', 'header'].includes(mode)) throw new Error(`[Bridge] Invalid tenancy.mode at ${path}.mode`);
  const isolationRaw = v['isolation'];
  if (!isRecord(isolationRaw)) throw new Error(`[Bridge] Expected object at ${path}.isolation`);
  const iso = {
    vault: asString(isolationRaw['vault'], `${path}.isolation.vault`) as CanonicalTenancy['isolation']['vault'],
    cache: asString(isolationRaw['cache'], `${path}.isolation.cache`) as CanonicalTenancy['isolation']['cache'],
    rateLimit: asString(isolationRaw['rateLimit'], `${path}.isolation.rateLimit`) as CanonicalTenancy['isolation']['rateLimit'],
  };
  if (!['global', 'per-tenant'].includes(iso.vault)) throw new Error(`[Bridge] Invalid tenancy.isolation.vault at ${path}.isolation.vault`);
  if (!['global', 'per-tenant'].includes(iso.cache)) throw new Error(`[Bridge] Invalid tenancy.isolation.cache at ${path}.isolation.cache`);
  if (!['global', 'per-tenant'].includes(iso.rateLimit)) throw new Error(`[Bridge] Invalid tenancy.isolation.rateLimit at ${path}.isolation.rateLimit`);
  const invariants = asArray(v['invariants'], `${path}.invariants`).map((x, i) => asString(x, `${path}.invariants[${i}]`));
  const keyRaw = v['key'];
  const key = keyRaw === undefined ? undefined : (() => {
    if (!isRecord(keyRaw)) throw new Error(`[Bridge] Expected object at ${path}.key`);
    const type = asString(keyRaw['type'], `${path}.key.type`) as NonNullable<CanonicalTenancy['key']>['type'];
    const value = asString(keyRaw['value'], `${path}.key.value`);
    if (!['field', 'schema', 'database'].includes(type)) throw new Error(`[Bridge] Invalid tenancy.key.type at ${path}.key.type`);
    assertSafeIdent(value, `${path}.key.value`);
    return { type, value } as NonNullable<CanonicalTenancy['key']>;
  })();
  return { mode, ...(key ? { key } : {}), isolation: iso, invariants };
}

function parseSecurity(v: unknown, path: string): CanonicalSecurity {
  if (!isRecord(v)) throw new Error(`[Bridge] Expected object at ${path}`);
  const rules = asArray(v['classificationRules'], `${path}.classificationRules`).map((x, i) => asString(x, `${path}.classificationRules[${i}]`));
  const shieldRaw = v['shieldDefaults'];
  if (!isRecord(shieldRaw)) throw new Error(`[Bridge] Expected object at ${path}.shieldDefaults`);
  const rateRaw = shieldRaw['rateLimit'];
  if (!isRecord(rateRaw)) throw new Error(`[Bridge] Expected object at ${path}.shieldDefaults.rateLimit`);
  const shieldDefaults = {
    maxDepth: asNumber(shieldRaw['maxDepth'], `${path}.shieldDefaults.maxDepth`),
    maxComplexity: asNumber(shieldRaw['maxComplexity'], `${path}.shieldDefaults.maxComplexity`),
    maxBodyBytes: asNumber(shieldRaw['maxBodyBytes'], `${path}.shieldDefaults.maxBodyBytes`),
    rateLimit: { max: asNumber(rateRaw['max'], `${path}.shieldDefaults.rateLimit.max`), windowMs: asNumber(rateRaw['windowMs'], `${path}.shieldDefaults.rateLimit.windowMs`) },
  };
  const corsRaw = v['corsDefaults'];
  if (!isRecord(corsRaw)) throw new Error(`[Bridge] Expected object at ${path}.corsDefaults`);
  const originsRaw = corsRaw['origins'];
  const origins = originsRaw === 'self' || originsRaw === '*' ? originsRaw : asArray(originsRaw, `${path}.corsDefaults.origins`).map((x, i) => asString(x, `${path}.corsDefaults.origins[${i}]`));
  const corsDefaults = {
    origins: origins as CanonicalSecurity['corsDefaults']['origins'],
    credentials: asBool(corsRaw['credentials'], `${path}.corsDefaults.credentials`),
    allowHeaders: asArray(corsRaw['allowHeaders'], `${path}.corsDefaults.allowHeaders`).map((x, i) => asString(x, `${path}.corsDefaults.allowHeaders[${i}]`)),
  };
  const findings = asArray(v['findings'], `${path}.findings`).map((x, i) => {
    if (!isRecord(x)) throw new Error(`[Bridge] Expected object at ${path}.findings[${i}]`);
    const code = asString(x['code'], `${path}.findings[${i}].code`);
    const severity = asString(x['severity'], `${path}.findings[${i}].severity`) as CanonicalSecurity['findings'][number]['severity'];
    if (!['info', 'warn', 'block'].includes(severity)) throw new Error(`[Bridge] Invalid finding.severity at ${path}.findings[${i}].severity`);
    const message = asString(x['message'], `${path}.findings[${i}].message`);
    const entityId = x['entityId'] === undefined ? undefined : asString(x['entityId'], `${path}.findings[${i}].entityId`);
    const field = x['field'] === undefined ? undefined : asString(x['field'], `${path}.findings[${i}].field`);
    return { code, severity, message, ...(entityId ? { entityId } : {}), ...(field ? { field } : {}) };
  });
  return { classificationRules: rules, shieldDefaults, corsDefaults, findings };
}

function parseField(v: unknown, path: string): CanonicalField {
  if (!isRecord(v)) throw new Error(`[Bridge] Expected object at ${path}`);
  const name = asString(v['name'], `${path}.name`);
  assertSafeIdent(name, `${path}.name`);
  const typeRaw = v['type'];
  if (!isRecord(typeRaw)) throw new Error(`[Bridge] Expected object at ${path}.type`);
  const kind = asString(typeRaw['kind'], `${path}.type.kind`);
  const typeName = asString(typeRaw['name'], `${path}.type.name`);
  const dbType = typeRaw['dbType'] === undefined ? undefined : asString(typeRaw['dbType'], `${path}.type.dbType`);
  const nullable = asBool(v['nullable'], `${path}.nullable`);
  const def = v['default'];
  const defVal = def === null ? null : def === undefined ? null : asString(def, `${path}.default`);
  const sensitivity = asString(v['sensitivity'], `${path}.sensitivity`);
  if (!['public', 'internal', 'pii', 'secret'].includes(sensitivity)) throw new Error(`[Bridge] Invalid field.sensitivity at ${path}.sensitivity`);
  const tenantKey = asBool(v['tenantKey'], `${path}.tenantKey`);
  return {
    name,
    type: { kind: kind as CanonicalField['type']['kind'], name: typeName, ...(dbType ? { dbType } : {}) },
    nullable,
    default: defVal,
    sensitivity: sensitivity as CanonicalField['sensitivity'],
    tenantKey,
  };
}

function parseEntity(v: unknown, path: string): CanonicalEntity {
  if (!isRecord(v)) throw new Error(`[Bridge] Expected object at ${path}`);
  const id = asString(v['id'], `${path}.id`);
  assertSafeIdent(id, `${path}.id`);
  const name = asString(v['name'], `${path}.name`);
  assertSafeIdent(name, `${path}.name`);
  const kind = asString(v['kind'], `${path}.kind`) as CanonicalEntity['kind'];
  if (!['table', 'view', 'resource'].includes(kind)) throw new Error(`[Bridge] Invalid entity.kind at ${path}.kind`);
  const namespace = asString(v['namespace'], `${path}.namespace`);
  assertSafeIdent(namespace, `${path}.namespace`);
  const fields = asArray(v['fields'], `${path}.fields`).map((x, i) => parseField(x, `${path}.fields[${i}]`));
  const primaryKey = asArray(v['primaryKey'], `${path}.primaryKey`).map((x, i) => asString(x, `${path}.primaryKey[${i}]`));
  const indexes = asArray(v['indexes'], `${path}.indexes`).map((x, i) => {
    if (!isRecord(x)) throw new Error(`[Bridge] Expected object at ${path}.indexes[${i}]`);
    return {
      fields: asArray(x['fields'], `${path}.indexes[${i}].fields`).map((y, j) => asString(y, `${path}.indexes[${i}].fields[${j}]`)),
      unique: asBool(x['unique'], `${path}.indexes[${i}].unique`),
    };
  });
  const constraints = asArray(v['constraints'], `${path}.constraints`).map((x, i) => {
    if (!isRecord(x)) throw new Error(`[Bridge] Expected object at ${path}.constraints[${i}]`);
    const type = asString(x['type'], `${path}.constraints[${i}].type`) as CanonicalEntity['constraints'][number]['type'];
    if (!['unique', 'check', 'fk', 'notnull'].includes(type)) throw new Error(`[Bridge] Invalid constraint.type at ${path}.constraints[${i}].type`);
    const expr = x['expr'] === undefined ? undefined : asString(x['expr'], `${path}.constraints[${i}].expr`);
    return { type, ...(expr ? { expr } : {}) };
  });
  const tags = asArray(v['tags'], `${path}.tags`).map((x, i) => asString(x, `${path}.tags[${i}]`));
  return { id, name, kind, namespace, fields, primaryKey, indexes, constraints, tags };
}

function parseRelation(v: unknown, path: string): CanonicalRelation {
  if (!isRecord(v)) throw new Error(`[Bridge] Expected object at ${path}`);
  const fromRaw = v['from'];
  const toRaw = v['to'];
  if (!isRecord(fromRaw)) throw new Error(`[Bridge] Expected object at ${path}.from`);
  if (!isRecord(toRaw)) throw new Error(`[Bridge] Expected object at ${path}.to`);
  const fromEntityId = asString(fromRaw['entityId'], `${path}.from.entityId`);
  const fromFields = asArray(fromRaw['fields'], `${path}.from.fields`).map((x, i) => asString(x, `${path}.from.fields[${i}]`));
  const toEntityId = asString(toRaw['entityId'], `${path}.to.entityId`);
  const toFields = asArray(toRaw['fields'], `${path}.to.fields`).map((x, i) => asString(x, `${path}.to.fields[${i}]`));
  const cardinality = asString(v['cardinality'], `${path}.cardinality`) as CanonicalRelation['cardinality'];
  if (!['1:1', '1:n', 'n:1', 'n:n'].includes(cardinality)) throw new Error(`[Bridge] Invalid relation.cardinality at ${path}.cardinality`);
  const enforced = asBool(v['enforced'], `${path}.enforced`);
  const tenantScoped = asBool(v['tenantScoped'], `${path}.tenantScoped`);
  return { from: { entityId: fromEntityId, fields: fromFields }, to: { entityId: toEntityId, fields: toFields }, cardinality, enforced, tenantScoped };
}

export function parseCanonicalModel(raw: unknown): CanonicalModel {
  if (!isRecord(raw)) throw new Error('[Bridge] CanonicalModel must be an object');
  const schemaVersion = asString(raw['schemaVersion'], 'schemaVersion');
  if (schemaVersion !== '1.0') throw new Error('[Bridge] Unsupported schemaVersion');
  const sourceRaw = raw['source'];
  if (!isRecord(sourceRaw)) throw new Error('[Bridge] source must be an object');
  const kind = asString(sourceRaw['kind'], 'source.kind');
  if (kind !== 'db' && kind !== 'http') throw new Error('[Bridge] Invalid source.kind');
  const source = {
    kind: kind as CanonicalModel['source']['kind'],
    name: asString(sourceRaw['name'], 'source.name'),
    fingerprint: asString(sourceRaw['fingerprint'], 'source.fingerprint'),
    ts: asNumber(sourceRaw['ts'], 'source.ts'),
  };
  const entities = asArray(raw['entities'], 'entities').map((x, i) => parseEntity(x, `entities[${i}]`));
  const relations = asArray(raw['relations'], 'relations').map((x, i) => parseRelation(x, `relations[${i}]`));
  const tenancy = parseTenancy(raw['tenancy'], 'tenancy');
  const security = parseSecurity(raw['security'], 'security');
  const overrides = raw['overrides'];
  if (overrides !== undefined) {
    return {
      schemaVersion: '1.0',
      source,
      entities,
      relations,
      tenancy,
      security,
      overrides: overrides as NonNullable<CanonicalModel['overrides']>,
    };
  }
  return {
    schemaVersion: '1.0',
    source,
    entities,
    relations,
    tenancy,
    security,
  };
}
