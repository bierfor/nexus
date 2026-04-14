import postgres from 'postgres';
import { applyInferredSecurity } from '@nexus_js/bridge';
import type { CanonicalEntity, CanonicalField, CanonicalModel, CanonicalRelation, CanonicalSecurity } from '@nexus_js/bridge';

export interface PostgresDiscoveryOptions {
  schemas?: string[];
  name?: string;
  connectTimeoutMs?: number;
  maxTables?: number;
}

interface PgColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
  data_type: string;
  udt_name: string;
  column_default: string | null;
}

interface PgPkRow {
  table_schema: string;
  table_name: string;
  column_name: string;
}

interface PgFkRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
  constraint_name: string;
}

function fingerprintFrom(dsn: string, schemas: string[]): string {
  const base = `${dsn.replace(/:[^:@/]+@/, ':***@')}|${schemas.join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a:${(h >>> 0).toString(16)}`;
}

function mapDbType(dataType: string, udt: string): CanonicalField['type'] {
  const dbType = udt || dataType;
  const t = (dbType || '').toLowerCase();
  const kind = t.includes('json') ? 'json' : t.includes('bytea') ? 'bytes' : 'scalar';
  return { kind, name: dbType, dbType };
}

export async function discoverPostgres(
  dsn: string,
  opts: PostgresDiscoveryOptions = {},
): Promise<CanonicalModel> {
  const schemas = (opts.schemas && opts.schemas.length > 0 ? opts.schemas : ['public']).map(s => String(s));
  const connectTimeoutMs = opts.connectTimeoutMs ?? 8_000;
  const maxTables = opts.maxTables ?? 500;

  const sql = postgres(dsn, {
    max: 1,
    idle_timeout: Math.ceil(connectTimeoutMs / 1000),
    connect_timeout: Math.ceil(connectTimeoutMs / 1000),
    prepare: false,
  });

  try {
    const tables = await sql<{ table_schema: string; table_name: string }[]>`
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema = any(${schemas})
      order by table_schema, table_name
      limit ${maxTables}
    `;

    const columns = await sql<PgColumnRow[]>`
      select table_schema, table_name, column_name, is_nullable, data_type, udt_name, column_default
      from information_schema.columns
      where table_schema = any(${schemas})
      order by table_schema, table_name, ordinal_position
    `;

    const pks = await sql<PgPkRow[]>`
      select tc.table_schema, tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = any(${schemas})
      order by tc.table_schema, tc.table_name, kcu.ordinal_position
    `;

    const fks = await sql<PgFkRow[]>`
      select
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema as foreign_table_schema,
        ccu.table_name as foreign_table_name,
        ccu.column_name as foreign_column_name,
        tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = any(${schemas})
      order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
    `;

    const pkMap = new Map<string, string[]>();
    for (const r of pks) {
      const key = `${r.table_schema}.${r.table_name}`;
      const list = pkMap.get(key) ?? [];
      list.push(r.column_name);
      pkMap.set(key, list);
    }

    const colsByTable = new Map<string, PgColumnRow[]>();
    for (const c of columns) {
      const key = `${c.table_schema}.${c.table_name}`;
      const list = colsByTable.get(key) ?? [];
      list.push(c);
      colsByTable.set(key, list);
    }

    const entities: CanonicalEntity[] = tables.map((t: { table_schema: string; table_name: string }) => {
      const key = `${t.table_schema}.${t.table_name}`;
      const cols = colsByTable.get(key) ?? [];
      const fields: CanonicalField[] = cols.map((c) => ({
        name: c.column_name,
        type: mapDbType(c.data_type, c.udt_name),
        nullable: c.is_nullable === 'YES',
        default: c.column_default ?? null,
        sensitivity: 'public',
        tenantKey: false,
      }));

      return {
        id: `table:${key}`,
        name: t.table_name,
        kind: 'table',
        namespace: t.table_schema,
        fields,
        primaryKey: pkMap.get(key) ?? [],
        indexes: [],
        constraints: [],
        tags: [],
      };
    });

    const entityByKey = new Map<string, CanonicalEntity>();
    for (const e of entities) {
      entityByKey.set(`${e.namespace}.${e.name}`, e);
    }

    const relations: CanonicalRelation[] = [];
    for (const fk of fks) {
      const fromKey = `${fk.table_schema}.${fk.table_name}`;
      const toKey = `${fk.foreign_table_schema}.${fk.foreign_table_name}`;
      const fromEntity = entityByKey.get(fromKey);
      const toEntity = entityByKey.get(toKey);
      if (!fromEntity || !toEntity) continue;
      relations.push({
        from: { entityId: fromEntity.id, fields: [fk.column_name] },
        to: { entityId: toEntity.id, fields: [fk.foreign_column_name] },
        cardinality: 'n:1',
        enforced: true,
        tenantScoped: false,
      });
    }

    const security: CanonicalSecurity = {
      classificationRules: [],
      shieldDefaults: {
        maxDepth: 10,
        maxComplexity: 600,
        maxBodyBytes: 1_000_000,
        rateLimit: { max: 120, windowMs: 60_000 },
      },
      corsDefaults: {
        origins: 'self',
        credentials: false,
        allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
      },
      findings: [],
    };

    const model: CanonicalModel = {
      schemaVersion: '1.0',
      source: {
        kind: 'db',
        name: opts.name ?? 'postgres',
        fingerprint: fingerprintFrom(dsn, schemas),
        ts: Date.now(),
      },
      entities,
      relations,
      tenancy: {
        mode: 'single',
        isolation: { vault: 'global', cache: 'global', rateLimit: 'global' },
        invariants: [],
      },
      security,
    };

    return applyInferredSecurity(model);
  } finally {
    await sql.end({ timeout: 2 });
  }
}
