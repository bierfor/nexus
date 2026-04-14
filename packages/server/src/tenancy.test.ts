import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { resolveTenant } from './tenancy.js';
import type { TenancyConfig } from './tenancy.js';

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

describe('resolveTenant', () => {
  it('header mode resolves tenant id', () => {
    const cfg: TenancyConfig = { mode: 'header', headerName: 'x-nexus-tenant-id' };
    const req = new Request('http://example.com/', { headers: { 'x-nexus-tenant-id': 'acme' } });
    const t = resolveTenant(req, cfg);
    expect(t?.id).toBe('acme');
    expect(t?.source).toBe('header');
  });

  it('subdomain mode resolves tenant id', () => {
    const cfg: TenancyConfig = { mode: 'subdomain', baseDomain: 'example.com' };
    const req = new Request('http://example.com/', { headers: { host: 'acme.example.com' } });
    const t = resolveTenant(req, cfg);
    expect(t?.id).toBe('acme');
  });

  it('jwt mode resolves tenant id', () => {
    const secret = 'test_secret';
    const token = signHs256({ tenantId: 'acme' }, secret);
    const cfg: TenancyConfig = { mode: 'jwt', jwtSecretName: 'NEXUS_TENANT_JWT_SECRET' };
    const req = new Request('http://example.com/', { headers: { authorization: `Bearer ${token}` } });
    const t = resolveTenant(req, cfg, new Map([['NEXUS_TENANT_JWT_SECRET', secret]]));
    expect(t?.id).toBe('acme');
    expect(t?.source).toBe('jwt');
  });
});

