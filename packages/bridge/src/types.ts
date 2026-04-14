export type SourceKind = 'db' | 'http';

export type EntityKind = 'table' | 'view' | 'resource';

export type FieldTypeKind = 'scalar' | 'enum' | 'json' | 'bytes';

export type FieldSensitivity = 'public' | 'internal' | 'pii' | 'secret';

export interface CanonicalSource {
  kind: SourceKind;
  name: string;
  fingerprint: string;
  ts: number;
}

export interface CanonicalModel {
  schemaVersion: '1.0';
  source: CanonicalSource;
  entities: CanonicalEntity[];
  relations: CanonicalRelation[];
  tenancy: CanonicalTenancy;
  security: CanonicalSecurity;
  overrides?: CanonicalOverrides;
}

export interface CanonicalEntity {
  id: string;
  name: string;
  kind: EntityKind;
  namespace: string;
  fields: CanonicalField[];
  primaryKey: string[];
  indexes: Array<{ fields: string[]; unique: boolean }>;
  constraints: Array<{ type: 'unique' | 'check' | 'fk' | 'notnull'; expr?: string }>;
  tags: string[];
}

export interface CanonicalFieldType {
  kind: FieldTypeKind;
  name: string;
  dbType?: string;
}

export interface CanonicalField {
  name: string;
  type: CanonicalFieldType;
  nullable: boolean;
  default: string | null;
  sensitivity: FieldSensitivity;
  tenantKey: boolean;
}

export interface CanonicalRelation {
  from: { entityId: string; fields: string[] };
  to: { entityId: string; fields: string[] };
  cardinality: '1:1' | '1:n' | 'n:1' | 'n:n';
  enforced: boolean;
  tenantScoped: boolean;
}

export interface CanonicalTenancy {
  mode: 'single' | 'subdomain' | 'path' | 'header';
  key?: { type: 'field' | 'schema' | 'database'; value: string };
  isolation: { vault: 'global' | 'per-tenant'; cache: 'global' | 'per-tenant'; rateLimit: 'global' | 'per-tenant' };
  invariants: string[];
}

export interface CanonicalShieldDefaults {
  maxDepth: number;
  maxComplexity: number;
  maxBodyBytes: number;
  rateLimit: { max: number; windowMs: number };
}

export interface CanonicalSecurityFinding {
  code: string;
  severity: 'info' | 'warn' | 'block';
  message: string;
  entityId?: string;
  field?: string;
}

export interface CanonicalSecurity {
  classificationRules: string[];
  shieldDefaults: CanonicalShieldDefaults;
  corsDefaults: { origins: 'self' | '*' | string[]; credentials: boolean; allowHeaders: string[] };
  findings: CanonicalSecurityFinding[];
}

export interface CanonicalOverrides {
  renames?: Array<{ from: string; to: string }>;
  securityOverrides?: Array<{ entityId: string; field: string; sensitivity: FieldSensitivity }>;
  tenancyOverrides?: Partial<CanonicalTenancy>;
}
