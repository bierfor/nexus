import * as jose from 'jose';
import type { NexusContext } from '@nexus_js/server/context';
import { getLocale } from './i18n.ts';

export const ADMIN_SESSION_COOKIE = 'pf_admin_token';

const COOKIE = ADMIN_SESSION_COOKIE;

const MIN_JWT_SECRET_LEN = 32;

/**
 * Same rules as mongo/backend `jwt-admin.ts` / `normalizedAdminJwtSecret` so verification
 * matches signing (trim, strip optional quotes from .env).
 */
function normalizedAdminJwtSecret(): string | null {
  const envRaw = process.env.NEXUS_ADMIN_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET;
  if (envRaw == null) return null;
  let s = envRaw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

function jwtSecretKey(): Uint8Array | null {
  const raw = normalizedAdminJwtSecret();
  if (!raw || raw.length < MIN_JWT_SECRET_LEN) return null;
  return new TextEncoder().encode(raw);
}

export function getAdminTokenFromCookie(ctx: NexusContext): string | null {
  const c = ctx.getCookie(COOKIE);
  return c?.trim() || null;
}

export async function verifyAdminJwt(token: string): Promise<boolean> {
  const key = jwtSecretKey();
  if (!key) return false;
  try {
    await jose.jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

/** True when the admin JWT cookie is present and verifies (SSR nav). */
export async function hasAdminSession(ctx: NexusContext): Promise<boolean> {
  const t = getAdminTokenFromCookie(ctx);
  if (!t) return false;
  return verifyAdminJwt(t);
}

/** Clears the editorial JWT cookie (e.g. logout route). */
export function clearAdminSessionCookie(ctx: NexusContext): void {
  ctx.setCookie(COOKIE, '', { path: '/', maxAge: 0, sameSite: 'Lax' });
}

/** Redirects to login with `next` when not authenticated. */
export async function requireAdmin(ctx: NexusContext): Promise<void> {
  const t = getAdminTokenFromCookie(ctx);
  if (!t || !(await verifyAdminJwt(t))) {
    const u = new URL(ctx.url.href);
    u.pathname = '/login';
    u.searchParams.set('lang', getLocale(ctx));
    /** Pathname only — never mirror arbitrary query (could contain pasted credentials). */
    u.searchParams.set('next', ctx.url.pathname);
    ctx.redirect(u.pathname + u.search, 302);
  }
}
