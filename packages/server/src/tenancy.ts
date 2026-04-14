import { createHmac, timingSafeEqual } from 'node:crypto';

export type TenancyMode = 'disabled' | 'subdomain' | 'custom-domain' | 'path' | 'header' | 'jwt';

export interface TenancyConfig {
  mode: TenancyMode;
  baseDomain?: string;
  pathPrefix?: string;
  headerName?: string;
  jwtHeader?: string;
  jwtSecretName?: string;
  customDomainMap?: Record<string, string>;
}

export interface TenantResolution {
  id: string;
  mode: Exclude<TenancyMode, 'disabled'>;
  source: 'host' | 'header' | 'jwt' | 'path' | 'custom-domain';
}

function hostWithoutPort(host: string): string {
  return host.split(':')[0] ?? host;
}

function extractSubdomain(host: string, baseDomain?: string): string | null {
  const h = hostWithoutPort(host).toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return null;
  if (baseDomain) {
    const bd = baseDomain.toLowerCase();
    if (h === bd) return null;
    if (!h.endsWith(`.${bd}`)) return null;
    const prefix = h.slice(0, -(bd.length + 1));
    const sub = prefix.split('.').filter(Boolean)[0] ?? '';
    if (!sub || sub === 'www') return null;
    return sub;
  }
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 3) return null;
  const sub = parts[0] ?? '';
  if (!sub || sub === 'www') return null;
  return sub;
}

function extractPathTenant(url: URL, pathPrefix?: string): string | null {
  const pfx = (pathPrefix ?? '').trim();
  const prefix = pfx.startsWith('/') ? pfx : `/${pfx}`;
  const pathname = url.pathname;
  if (!prefix || prefix === '/') return null;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const seg = rest.split('/').filter(Boolean)[0] ?? '';
  if (!seg) return null;
  return seg;
}

function base64urlDecodeToBuffer(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function verifyJwtHs256(token: string, secret: string): unknown | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  if (!h || !p || !sig) return null;
  const data = `${h}.${p}`;
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  const payloadBuf = base64urlDecodeToBuffer(p);
  const payload = safeJsonParse(payloadBuf.toString('utf8'));
  return payload;
}

export function resolveTenant(req: Request, config: TenancyConfig, secrets?: ReadonlyMap<string, string>): TenantResolution | null {
  const mode = config.mode;
  if (mode === 'disabled') return null;

  if (mode === 'header') {
    const headerName = (config.headerName ?? 'x-nexus-tenant-id').toLowerCase();
    const v = req.headers.get(headerName) ?? req.headers.get(headerName.toUpperCase());
    const id = String(v ?? '').trim();
    if (!id) return null;
    return { id, mode, source: 'header' };
  }

  if (mode === 'jwt') {
    const headerName = (config.jwtHeader ?? 'authorization').toLowerCase();
    const raw = req.headers.get(headerName) ?? '';
    const token = raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw.trim();
    if (!token) return null;
    const secretName = config.jwtSecretName ?? 'NEXUS_TENANT_JWT_SECRET';
    const secret = (secrets?.get(secretName) ?? secrets?.get(`GLOBAL/${secretName}`) ?? '').trim();
    if (!secret) return null;
    const payload = verifyJwtHs256(token, secret);
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    const id = typeof p['tenantId'] === 'string' ? p['tenantId'] : typeof p['tenant'] === 'string' ? p['tenant'] : '';
    if (!id) return null;
    return { id, mode, source: 'jwt' };
  }

  if (mode === 'path') {
    const url = new URL(req.url);
    const id = extractPathTenant(url, config.pathPrefix);
    if (!id) return null;
    return { id, mode, source: 'path' };
  }

  if (mode === 'custom-domain') {
    const host = req.headers.get('host') ?? '';
    const h = hostWithoutPort(host).toLowerCase();
    if (!h) return null;
    const mapped = config.customDomainMap?.[h];
    if (!mapped) return null;
    return { id: mapped, mode, source: 'custom-domain' };
  }

  if (mode === 'subdomain') {
    const host = req.headers.get('host') ?? '';
    const id = extractSubdomain(host, config.baseDomain);
    if (!id) return null;
    return { id, mode, source: 'host' };
  }

  return null;
}

