/**
 * Nexus JWT — HS256 signing and verification backed by the Vault.
 *
 * Key design goals
 * ────────────────
 *  1. Zero external JWT library — uses only Node.js `node:crypto` to avoid
 *     supply-chain risk and keep the package small.
 *
 *  2. Vault-backed key rotation with a grace period so existing valid tokens
 *     are not instantly invalidated when you rotate the secret.
 *     On vault patch: old key stays valid for `gracePeriodMs` (default 5 min),
 *     then all tokens signed with it are rejected.
 *
 *  3. timingSafeEqual comparison everywhere to prevent timing attacks.
 *
 * Usage
 * ─────
 *  // In your Nexus server init:
 *  const jwtService = createJwtService({
 *    vaultKey:  'JWT_SECRET',   // vault key that holds the signing secret
 *    issuer:    'my-app',
 *    expiresIn: 3600,           // 1 hour
 *  });
 *
 *  // Sign:
 *  const token = jwtService.sign({ sub: userId, role: 'user' });
 *
 *  // Verify (in GraphQL resolver / action):
 *  const payload = jwtService.verify(token);  // throws on invalid
 *
 *  // Rotate (call from vault hot-reload handler, or schedule):
 *  jwtService.rotate('new-secret-at-least-32-chars');
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { NexusVault } from '@nexus_js/security';

// ── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject — typically user ID */
  sub:   string;
  /** Issued-at (epoch seconds) */
  iat:   number;
  /** Expiry (epoch seconds) */
  exp:   number;
  /** Issuer */
  iss?:  string;
  /** JWT ID — random, useful for revocation lists */
  jti?:  string;
  /** Arbitrary custom claims */
  [key: string]: unknown;
}

export interface JwtServiceOptions {
  /**
   * Vault key whose value is used as the HMAC signing secret.
   * Must be ≥ 32 bytes (the vault value is used as UTF-8).
   */
  vaultKey:   string;
  /**
   * Issuer claim (`iss`). Include in tokens and verified on decode.
   */
  issuer?:    string;
  /**
   * Token lifetime in **seconds**. Default: 3600 (1 hour).
   */
  expiresIn?: number;
  /**
   * How long (ms) the **old** key remains valid after rotation.
   * Default: 300 000 (5 minutes). During this window tokens signed with the
   * old key are still accepted so users are not force-logged-out mid-session.
   */
  gracePeriodMs?: number;
  /**
   * Whether to include a unique `jti` (JWT ID) in every token.
   * Needed for single-use / revocation scenarios. Default: false.
   */
  includeJti?: boolean;
}

export interface JwtService {
  /** Create a signed JWT containing the given payload additions. */
  sign(claims: Omit<JwtPayload, 'iat' | 'exp' | 'iss' | 'jti'>): string;
  /**
   * Verify and decode a JWT.
   * Throws an informative error (without leaking secret) on any failure.
   */
  verify(token: string): JwtPayload;
  /**
   * Immediately rotate the signing key.
   * The old key enters the grace window and is discarded after `gracePeriodMs`.
   * Normally called automatically when the vault patches `vaultKey`.
   */
  rotate(newSecret: string): void;
}

// ── Grace-window entry ───────────────────────────────────────────────────────

interface GraceKey {
  secret:    string;
  expiresAt: number;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a JWT service bound to a Vault instance.
 * Vault updates to `vaultKey` automatically trigger key rotation.
 *
 * @param vault   Nexus vault instance (from `nexusVault` or your own)
 * @param opts    Service configuration
 */
export function createJwtService(
  vault: NexusVault,
  opts:  JwtServiceOptions,
): JwtService {
  const {
    vaultKey,
    issuer,
    expiresIn    = 3600,
    gracePeriodMs = 300_000,
    includeJti   = false,
  } = opts;

  let currentSecret = vault.get(vaultKey) ?? '';
  const graceKeys: GraceKey[] = [];

  // Subscribe to vault hot-reload
  vault.subscribe(() => {
    const next = vault.get(vaultKey);
    if (next && next !== currentSecret) {
      service.rotate(next);
    }
  });

  // ── Internal helpers ───────────────────────────────────────────────────────

  function b64url(str: string): string {
    return Buffer.from(str).toString('base64url');
  }

  function makeHeader(): string {
    return b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  }

  function signParts(header: string, body: string, secret: string): string {
    return createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
  }

  function pruneGraceKeys(): void {
    const now = Date.now();
    // Remove expired grace keys from the back
    while (graceKeys.length > 0 && graceKeys[graceKeys.length - 1]!.expiresAt < now) {
      graceKeys.pop();
    }
  }

  // ── Service implementation ─────────────────────────────────────────────────

  const service: JwtService = {
    sign(claims) {
      if (!currentSecret || currentSecret.length < 32) {
        throw new Error(
          `[Nexus JWT] Vault key "${vaultKey}" is missing or shorter than 32 characters. ` +
          'Set it via NEXUS_SECRET / vault.patch().',
        );
      }
      const now = Math.floor(Date.now() / 1000);
      const payload: JwtPayload = {
        sub: String(claims.sub ?? ''),
        ...claims,
        iat: now,
        exp: now + expiresIn,
        ...(issuer     ? { iss: issuer }           : {}),
        ...(includeJti ? { jti: randomBytes(16).toString('hex') } : {}),
      };
      const header = makeHeader();
      const body   = b64url(JSON.stringify(payload));
      const sig    = signParts(header, body, currentSecret);
      return `${header}.${body}.${sig}`;
    },

    verify(token) {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('[Nexus JWT] Malformed token: expected 3 segments.');
      }
      const [header, body, sig] = parts as [string, string, string];

      pruneGraceKeys();

      // Try current key first, then grace keys
      const candidates = [
        currentSecret,
        ...graceKeys.map(k => k.secret),
      ].filter(Boolean);

      let payload: JwtPayload | null = null;

      for (const secret of candidates) {
        const expected = Buffer.from(signParts(header, body, secret));
        const actual   = Buffer.from(sig);

        // Lengths must match for timingSafeEqual
        if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
          try {
            payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
          } catch {
            throw new Error('[Nexus JWT] Token body is not valid JSON.');
          }
          break;
        }
      }

      if (!payload) {
        throw new Error('[Nexus JWT] Invalid signature.');
      }

      const now = Math.floor(Date.now() / 1000);

      if (payload.exp !== undefined && now > payload.exp) {
        throw new Error('[Nexus JWT] Token has expired.');
      }

      // Clock-skew guard: issued more than 5 seconds in the future → reject
      if (payload.iat !== undefined && payload.iat > now + 5) {
        throw new Error('[Nexus JWT] Token issued-at is in the future (clock skew).');
      }

      if (issuer && payload.iss !== issuer) {
        throw new Error(`[Nexus JWT] Token issuer "${payload.iss}" does not match expected "${issuer}".`);
      }

      return payload;
    },

    rotate(newSecret: string) {
      if (!newSecret || newSecret.length < 32) {
        throw new Error('[Nexus JWT] New secret must be at least 32 characters.');
      }
      if (currentSecret) {
        graceKeys.unshift({ secret: currentSecret, expiresAt: Date.now() + gracePeriodMs });
        // Cap grace list to prevent unbounded growth (keep at most 5 old keys)
        while (graceKeys.length > 5) graceKeys.pop();
      }
      currentSecret = newSecret;
    },
  };

  return service;
}

// ── Standalone helpers (for apps that manage their own key) ──────────────────

/**
 * Sign a JWT with an explicit secret (not vault-backed).
 * Useful in tests or edge cases where you don't need hot rotation.
 */
export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'> & { sub: string },
  secret:  string,
  expiresIn = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + expiresIn };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig    = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * Verify a JWT with an explicit secret (not vault-backed).
 */
export function verifyJwt(token: string, secret: string, issuer?: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('[Nexus JWT] Malformed token.');
  const [header, body, sig] = parts as [string, string, string];

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url'),
  );
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('[Nexus JWT] Invalid signature.');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
  } catch {
    throw new Error('[Nexus JWT] Token body is not valid JSON.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && now > payload.exp) {
    throw new Error('[Nexus JWT] Token has expired.');
  }
  if (payload.iat !== undefined && payload.iat > now + 5) {
    throw new Error('[Nexus JWT] Token issued in the future.');
  }
  if (issuer && payload.iss !== issuer) {
    throw new Error(`[Nexus JWT] Issuer mismatch.`);
  }
  return payload;
}
