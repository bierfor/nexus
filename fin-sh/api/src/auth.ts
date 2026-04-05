import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import bcrypt from 'bcryptjs';
import { Session, User } from './models.js';

export type AuthUser = {
  _id: unknown;
  email: string;
  passwordHash: string;
  name?: string;
  plan?: string;
  role?: string;
  stripeCustomerId?: string;
  stripeSubscriptionStatus?: string;
  stripeCurrentPeriodEnd?: Date | null;
  /** Premium/Business: interstitial preference for Free-tier snapshot links (default true). */
  shortLinkAdsEnabled?: boolean;
};

const SESSION_COOKIE = 'finsh_session';
const SESSION_DAYS = 14;

export { SESSION_COOKIE };
/** Max-Age for Set-Cookie (seconds). */
export const SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 60 * 60;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function parseSessionToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim() || null;
  }
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== 'string') return null;
  const m = /(?:^|;\s*)finsh_session=([^;]+)/.exec(raw);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

export async function getUserFromRequest(req: IncomingMessage): Promise<AuthUser | null> {
  const token = parseSessionToken(req);
  if (!token) return null;
  const s = (await Session.findOne({ token, expiresAt: { $gt: new Date() } }).lean()) as
    | { userId?: unknown }
    | null;
  if (!s?.userId) return null;
  const user = (await User.findById(s.userId).lean()) as AuthUser | null;
  return user;
}

export async function createSessionForUser(userId: unknown): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await Session.create({ token, userId, expiresAt });
  return token;
}

export async function destroySession(req: IncomingMessage): Promise<void> {
  const token = parseSessionToken(req);
  if (token) await Session.deleteOne({ token });
}

export function serializeUser(user: {
  _id: unknown;
  email: string;
  name?: string;
  plan?: string;
  role?: string;
  stripeCustomerId?: string;
  stripeSubscriptionStatus?: string;
  stripeCurrentPeriodEnd?: Date | null;
  shortLinkAdsEnabled?: boolean;
}) {
  const end = user.stripeCurrentPeriodEnd;
  return {
    id: String(user._id),
    email: user.email,
    name: user.name ?? '',
    plan: user.plan ?? 'free',
    role: user.role ?? 'user',
    stripeSubscriptionStatus: user.stripeSubscriptionStatus ?? '',
    billingPeriodEndsAt: end ? new Date(end as Date).toISOString() : '',
    billingPortalAvailable: !!(user.stripeCustomerId && String(user.stripeCustomerId).trim()),
    shortLinkAdsEnabled: user.shortLinkAdsEnabled !== false,
  };
}
