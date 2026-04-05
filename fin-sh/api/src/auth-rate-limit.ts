import type { IncomingMessage } from 'node:http';
import { clientIp } from './analytics.js';

type Kind = 'login' | 'register';

const buckets = new Map<string, { fails: number; resetAt: number }>();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 14;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_FAILS = 10;

function bucketKey(kind: Kind, req: IncomingMessage): string {
  return `${kind}:${clientIp(req)}`;
}

export function assertAuthRateAllowed(req: IncomingMessage, kind: Kind): void {
  const k = bucketKey(kind, req);
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || now > b.resetAt) return;
  const max = kind === 'login' ? LOGIN_MAX_FAILS : REGISTER_MAX_FAILS;
  if (b.fails >= max) {
    throw new Error('Too many attempts. Please wait before trying again.');
  }
}

export function recordAuthFailure(req: IncomingMessage, kind: Kind): void {
  const k = bucketKey(kind, req);
  const now = Date.now();
  const windowMs = kind === 'login' ? LOGIN_WINDOW_MS : REGISTER_WINDOW_MS;
  let b = buckets.get(k);
  if (!b || now > b.resetAt) {
    b = { fails: 0, resetAt: now + windowMs };
    buckets.set(k, b);
  }
  b.fails += 1;
}

export function clearAuthFailures(req: IncomingMessage, kind: Kind): void {
  buckets.delete(bucketKey(kind, req));
}
