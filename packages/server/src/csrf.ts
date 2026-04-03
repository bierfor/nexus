/**
 * Nexus Action Integrity — Anti-CSRF & Anti-Replay Protection.
 *
 * Every Server Action invocation is protected by an ephemeral, HMAC-signed,
 * single-use token. The flow:
 *
 *   1. Server renders an island → calls generateActionToken(sessionId, action)
 *   2. Token is embedded in the HTML as a data attribute on the island
 *   3. Client POSTs the action with the token in x-nexus-action-token header
 *   4. Server calls validateActionToken() — verifies HMAC, session, expiry, and
 *      "burns" the token (single-use). A replay of the same token → blocked.
 *
 * Properties:
 *  - HMAC-SHA256 signed with the app secret (tamper-proof)
 *  - Bound to sessionId + actionName (no cross-action reuse)
 *  - Expires after ACTION_TOKEN_TTL (default 15 min)
 *  - Single-use: consumed on first valid use (replay attack prevention)
 *  - Constant-time comparison to prevent timing attacks
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token lifetime — 15 minutes. Matches typical form interaction time. */
const ACTION_TOKEN_TTL_MS = 15 * 60 * 1_000;

/**
 * In-memory set of consumed tokens. In a multi-process / serverless deployment
 * this should be backed by Redis or a distributed cache. For single-process
 * (Node.js server) this is sufficient.
 */
const USED_TOKENS = new Set<string>();

/** Request header name for the action token. */
export const ACTION_TOKEN_HEADER = 'x-nexus-action-token';

export interface TokenValidationResult {
  valid:    boolean;
  reason?:  string;
  /** True if the token was valid but has been consumed (replay attempt). */
  replayed?: boolean;
}

// ── Token generation ──────────────────────────────────────────────────────────

/**
 * Generates a signed, single-use action token.
 *
 * @param sessionId   Unique identifier for the current user session (cookie, JWT sub, etc.)
 * @param actionName  The action being authorized (e.g. 'capture', 'update-favorites')
 * @param secret      App-level secret — should come from process.env.NEXUS_SECRET
 * @returns           base64url-encoded token safe to embed in HTML
 */
export function generateActionToken(
  sessionId:  string,
  actionName: string,
  secret:     string,
): string {
  const ts    = Date.now().toString(36);           // compact timestamp
  const nonce = randomBytes(8).toString('hex');    // 8 bytes = 64 bits of entropy
  const payload = `${sessionId}\x00${actionName}\x00${ts}\x00${nonce}`;
  const sig   = sign(payload, secret);
  return Buffer.from(`${payload}\x00${sig}`).toString('base64url');
}

// ── Token validation ──────────────────────────────────────────────────────────

/**
 * Validates and consumes an action token. Calling this twice with the same
 * token will return `{ valid: false, replayed: true }` on the second call.
 *
 * @param token       Token from x-nexus-action-token header
 * @param sessionId   Current user's session ID
 * @param actionName  The action being invoked
 * @param secret      Same secret used during generation
 */
export function validateActionToken(
  token:      string,
  sessionId:  string,
  actionName: string,
  secret:     string,
): TokenValidationResult {
  // 1. Replay check (fast path before expensive HMAC)
  if (USED_TOKENS.has(token)) {
    return { valid: false, replayed: true, reason: 'Token already used — replay attack prevented' };
  }

  // 2. Decode
  let raw: string;
  try {
    raw = Buffer.from(token, 'base64url').toString('utf-8');
  } catch {
    return { valid: false, reason: 'Malformed token (invalid base64url)' };
  }

  const parts = raw.split('\x00');
  if (parts.length !== 5) {
    return { valid: false, reason: 'Malformed token (wrong structure)' };
  }

  const [tokenSession, tokenAction, tsBase36, , sig] = parts as [string, string, string, string, string];
  const payloadWithoutSig = parts.slice(0, 4).join('\x00');

  // 3. Verify HMAC in constant time (prevents timing side-channel)
  const expectedSig = sign(payloadWithoutSig, secret);
  if (!safeEqual(sig, expectedSig)) {
    return { valid: false, reason: 'Invalid signature — possible CSRF attack' };
  }

  // 4. Verify session binding
  if (tokenSession !== sessionId) {
    return { valid: false, reason: 'Session mismatch — token not issued for this user' };
  }

  // 5. Verify action binding
  if (tokenAction !== actionName) {
    return { valid: false, reason: `Action mismatch — expected "${actionName}", got "${tokenAction}"` };
  }

  // 6. Check expiry
  const issuedAt = parseInt(tsBase36, 36);
  if (Date.now() - issuedAt > ACTION_TOKEN_TTL_MS) {
    return { valid: false, reason: `Token expired (issued ${Math.round((Date.now() - issuedAt) / 60_000)}m ago)` };
  }

  // 7. Consume (burn) the token — prevents replay
  USED_TOKENS.add(token);
  pruneUsedTokens();

  return { valid: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Prune the used-token set to prevent unbounded memory growth.
 * Tokens older than TTL are safe to forget — they'd fail the expiry check.
 */
function pruneUsedTokens(): void {
  if (USED_TOKENS.size < 50_000) return;
  // Tokens are not stored with timestamps — simplest safe eviction is to
  // clear the oldest ~10% (insertion-order Set).
  const deleteCount = Math.floor(USED_TOKENS.size * 0.1);
  const iter = USED_TOKENS.values();
  for (let i = 0; i < deleteCount; i++) {
    const v = iter.next().value;
    if (v !== undefined) USED_TOKENS.delete(v);
  }
}

// ── Middleware helper ─────────────────────────────────────────────────────────

/**
 * Extracts session ID from a request using common patterns.
 * Override with your own session logic in production.
 */
export function extractSessionId(request: Request): string {
  // Try standard session cookie patterns
  const cookie = request.headers.get('cookie') ?? '';
  const sessionMatch =
    cookie.match(/(?:nexus-session|__session|session)=([^;]+)/) ??
    cookie.match(/([a-f0-9]{32,})/);
  if (sessionMatch?.[1]) return sessionMatch[1];

  // Fall back to IP + User-Agent fingerprint (not ideal, but workable for anonymous sessions)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  const ua = request.headers.get('user-agent') ?? '';
  return `anon:${sign(`${ip}:${ua}`, 'nexus-anon-fp').slice(0, 16)}`;
}

/**
 * Generates a session ID that is safe to store in a cookie.
 */
export function generateSessionId(): string {
  return randomBytes(24).toString('base64url');
}
