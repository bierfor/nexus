import { describe, it, expect } from 'vitest';
import { applyInferredSecurity } from './infer.js';
import type { CanonicalModel } from './types.js';

describe('applyInferredSecurity', () => {
  it('marks secret fields and detects tenancy by tenant_id', () => {
    const model: CanonicalModel = {
      schemaVersion: '1.0',
      source: { kind: 'db', name: 't', fingerprint: 'x', ts: 0 },
      entities: [
        {
          id: 'table:public.users',
          name: 'users',
          kind: 'table',
          namespace: 'public',
          fields: [
            { name: 'id', type: { kind: 'scalar', name: 'uuid', dbType: 'uuid' }, nullable: false, default: null, sensitivity: 'public', tenantKey: false },
            { name: 'tenant_id', type: { kind: 'scalar', name: 'uuid', dbType: 'uuid' }, nullable: false, default: null, sensitivity: 'public', tenantKey: false },
            { name: 'password_hash', type: { kind: 'scalar', name: 'text', dbType: 'text' }, nullable: false, default: null, sensitivity: 'public', tenantKey: false },
          ],
          primaryKey: ['id'],
          indexes: [],
          constraints: [],
          tags: [],
        },
      ],
      relations: [],
      tenancy: { mode: 'single', isolation: { vault: 'global', cache: 'global', rateLimit: 'global' }, invariants: [] },
      security: {
        classificationRules: [],
        shieldDefaults: { maxDepth: 10, maxComplexity: 600, maxBodyBytes: 1_000_000, rateLimit: { max: 120, windowMs: 60_000 } },
        corsDefaults: { origins: 'self', credentials: false, allowHeaders: [] },
        findings: [],
      },
    };

    const out = applyInferredSecurity(model);
    expect(out.tenancy.mode).toBe('subdomain');
    expect(out.entities[0]!.fields.find(f => f.name === 'tenant_id')!.tenantKey).toBe(true);
    expect(out.entities[0]!.fields.find(f => f.name === 'password_hash')!.sensitivity).toBe('secret');
  });
});

