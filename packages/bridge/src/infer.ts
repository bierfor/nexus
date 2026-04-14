import type { CanonicalEntity, CanonicalField, CanonicalModel, CanonicalSecurityFinding, CanonicalTenancy, FieldSensitivity } from './types.js';

export function classifyFieldSensitivity(fieldName: string): { sensitivity: FieldSensitivity; rule: string } {
  const n = fieldName.toLowerCase();
  if (
    n.includes('password') ||
    n.includes('passwd') ||
    n.includes('secret') ||
    n.includes('token') ||
    n.includes('api_key') ||
    n.endsWith('_key') ||
    n.includes('private_key') ||
    n.includes('refresh_token') ||
    n.includes('access_token') ||
    n.includes('salt')
  ) return { sensitivity: 'secret', rule: 'name:secret' };

  if (
    n.includes('email') ||
    n.includes('phone') ||
    n.includes('address') ||
    n.includes('first_name') ||
    n.includes('last_name') ||
    n === 'name' ||
    n.includes('ip') ||
    n.includes('dob') ||
    n.includes('birth')
  ) return { sensitivity: 'pii', rule: 'name:pii' };

  if (n.startsWith('_') || n.includes('internal')) return { sensitivity: 'internal', rule: 'name:internal' };
  return { sensitivity: 'public', rule: 'default:public' };
}

export function detectTenancyFromEntities(entities: CanonicalEntity[]): { tenancy: CanonicalTenancy; findings: CanonicalSecurityFinding[] } {
  const tenantFieldCandidates = ['tenant_id', 'account_id', 'org_id', 'organization_id', 'workspace_id'];

  const findings: CanonicalSecurityFinding[] = [];

  let detectedField: string | null = null;
  for (const e of entities) {
    for (const f of e.fields) {
      if (tenantFieldCandidates.includes(f.name.toLowerCase())) {
        detectedField = f.name;
        break;
      }
    }
    if (detectedField) break;
  }

  if (!detectedField) {
    return {
      tenancy: {
        mode: 'single',
        isolation: { vault: 'global', cache: 'global', rateLimit: 'global' },
        invariants: [],
      },
      findings: [
        {
          code: 'TENANCY_NOT_DETECTED',
          severity: 'info',
          message: 'No tenant key detected. Multi-tenancy generation is disabled until configured.',
        },
      ],
    };
  }

  findings.push({
    code: 'TENANCY_DETECTED',
    severity: 'info',
    message: `Detected tenancy key field "${detectedField}".`,
  });

  return {
    tenancy: {
      mode: 'subdomain',
      key: { type: 'field', value: detectedField },
      isolation: { vault: 'per-tenant', cache: 'per-tenant', rateLimit: 'per-tenant' },
      invariants: [
        'tenantId_required',
        'vault_per_tenant',
        'cache_per_tenant',
        'rateLimit_per_tenant',
      ],
    },
    findings,
  };
}

export function applyInferredSecurity(model: CanonicalModel): CanonicalModel {
  const rules = new Set<string>();

  const entities = model.entities.map((e) => {
    const fields = e.fields.map((f) => {
      const inferred = classifyFieldSensitivity(f.name);
      rules.add(inferred.rule);
      return { ...f, sensitivity: inferred.sensitivity } satisfies CanonicalField;
    });
    return { ...e, fields };
  });

  const tenancyResult = detectTenancyFromEntities(entities);

  const mergedFindings = [
    ...(model.security.findings ?? []),
    ...tenancyResult.findings,
  ];

  const sec = {
    ...model.security,
    classificationRules: Array.from(new Set([...model.security.classificationRules, ...rules])),
    findings: mergedFindings,
  };

  const tenancy = model.tenancy.mode === 'single' ? tenancyResult.tenancy : model.tenancy;

  const entitiesWithTenantKey = tenancy.key?.type === 'field'
    ? entities.map((e) => ({
        ...e,
        fields: e.fields.map((f) => ({
          ...f,
          tenantKey: f.name === tenancy.key!.value,
        })),
      }))
    : entities;

  return {
    ...model,
    entities: entitiesWithTenantKey,
    tenancy,
    security: sec,
  };
}
