/**
 * Nexus Multi-Tenant — First-Class Tenant Isolation.
 *
 * Detects the tenant from the incoming request (subdomain or custom domain)
 * and provides a typed TenantContext that's automatically available in every
 * .nx file via $context().tenant.
 *
 * Modes:
 *   'subdomain'     → empresa-a.nexus.app → tenant.id = 'empresa-a'
 *   'custom-domain' → empresa-b.com       → tenant.id resolved by resolver fn
 *   'path'          → nexus.app/t/empresa-a/dashboard → tenant.id = 'empresa-a'
 *
 * The router automatically:
 *   - Isolates Cache-Control per tenant (x-nexus-tenant-id header)
 *   - Scopes Shield Cache keys: `${tenantId}:${routeKey}`
 *   - Passes tenant to every Server Action via ctx.tenant
 *   - Prevents cross-tenant data leaks by design
 */

export type TenantMode = 'subdomain' | 'custom-domain' | 'path' | 'disabled';

export interface TenantInfo {
  /** Unique identifier for this tenant (e.g. 'empresa-a') */
  id:              string;
  /** Full hostname as received (empresa-a.nexus.app or empresa-b.com) */
  domain:          string;
  /** true if tenant is using a custom domain (not the base domain) */
  isCustomDomain:  boolean;
  /** Subdomain portion (only set in subdomain mode) */
  subdomain?:      string | undefined;
  /** Resolved metadata from your resolver function */
  meta?:           Record<string, unknown> | undefined;
}

export interface TenantConfig<TMeta = Record<string, unknown>> {
  mode:       TenantMode;
  /** Your app's base domain (e.g. 'nexus.app') */
  baseDomain?: string;
  /** Path prefix for path-based tenancy (e.g. '/t/') */
  pathPrefix?: string;
  /**
   * Optional async resolver — fetch tenant metadata (name, plan, logo, etc.)
   * from your DB when a tenant is identified. Result is cached per request.
   */
  resolve?:   (tenantId: string, request: Request) => Promise<TMeta | null>;
  /** Tenant to use when no tenant is detected (e.g. your main marketing site) */
  fallback?:  TenantInfo;
}

// ── Extraction helpers ────────────────────────────────────────────────────────

function extractSubdomain(host: string, baseDomain: string): string | null {
  // empresa-a.nexus.app → empresa-a  (baseDomain = 'nexus.app')
  // nexus.app → null (it's the root domain)
  // empresa-b.com → null (not a subdomain of baseDomain)
  if (!host.endsWith(`.${baseDomain}`)) return null;
  const sub = host.slice(0, host.length - baseDomain.length - 1);
  return sub.length > 0 && !sub.includes('.') ? sub : null;
}

function extractPathTenant(pathname: string, prefix: string): string | null {
  // /t/empresa-a/dashboard → empresa-a  (prefix = '/t/')
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const id = rest.split('/')[0];
  return id?.length ? id : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extracts tenant information from a Web-standard Request.
 * Returns null if the request doesn't map to any tenant
 * (e.g. the root marketing site).
 */
export async function extractTenant<TMeta = Record<string, unknown>>(
  request: Request,
  config: TenantConfig<TMeta>,
): Promise<TenantInfo | null> {
  if (config.mode === 'disabled') return config.fallback ?? null;

  const url  = new URL(request.url);
  const host = request.headers.get('host') ?? url.hostname;

  let tenantId: string | null = null;
  let isCustomDomain = false;
  let subdomain: string | undefined;

  switch (config.mode) {
    case 'subdomain': {
      const base = config.baseDomain ?? url.hostname.split('.').slice(1).join('.');
      subdomain = extractSubdomain(host, base) ?? undefined;
      if (!subdomain) return config.fallback ?? null;
      tenantId = subdomain;
      break;
    }

    case 'custom-domain': {
      const base = config.baseDomain ?? '';
      // If it matches the base domain → not a custom domain
      if (base && (host === base || host.endsWith(`.${base}`))) {
        subdomain = extractSubdomain(host, base) ?? undefined;
        tenantId  = subdomain ?? null;
      } else {
        // Fully custom domain
        isCustomDomain = true;
        tenantId = host;
      }
      if (!tenantId) return config.fallback ?? null;
      break;
    }

    case 'path': {
      const prefix = config.pathPrefix ?? '/t/';
      tenantId = extractPathTenant(url.pathname, prefix);
      if (!tenantId) return config.fallback ?? null;
      break;
    }
  }

  const tenant: TenantInfo = {
    id:             tenantId!,
    domain:         host,
    isCustomDomain,
    subdomain,
  };

  // Resolve optional metadata (plan, logo, DB row, etc.)
  if (config.resolve) {
    try {
      const meta = await config.resolve(tenantId!, request);
      if (meta) tenant.meta = meta as Record<string, unknown>;
    } catch {
      // Resolver failure → still return tenant with no meta (don't 500)
    }
  }

  return tenant;
}

/**
 * Scopes a Shield Cache key to a specific tenant.
 * Prevents data from tenant A being served to tenant B.
 *
 * @example
 * const cacheKey = scopeTenantKey(tenant, `list:${page}`);
 * // → 'empresa-a:list:1'
 */
export function scopeTenantKey(tenant: TenantInfo | null, key: string): string {
  return tenant ? `${tenant.id}:${key}` : key;
}

/**
 * Middleware-style helper — reads or injects the tenant into request headers.
 * Useful for logging and downstream cache isolation.
 */
export function tenantHeaders(tenant: TenantInfo | null): Record<string, string> {
  if (!tenant) return {};
  return {
    'x-nexus-tenant':        tenant.id,
    'x-nexus-tenant-domain': tenant.domain,
    ...(tenant.isCustomDomain ? { 'x-nexus-custom-domain': '1' } : {}),
  };
}

/**
 * Helper: builds a tenant-aware Cache-Control vary header.
 * CDNs that respect Vary will automatically serve different cache entries
 * per tenant when using subdomain routing.
 */
export function tenantVaryHeader(mode: TenantMode): string {
  switch (mode) {
    case 'subdomain':
    case 'custom-domain': return 'host';
    case 'path':          return 'x-nexus-tenant';
    default:              return '';
  }
}
