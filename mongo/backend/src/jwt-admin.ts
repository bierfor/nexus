import * as jose from "jose";

const MIN_SECRET_LEN = 32;

/** Igual que ADMIN_SECRET: trim y quitar comillas del .env. */
function normalizedAdminJwtSecret(): string | null {
  const envRaw = process.env.ADMIN_JWT_SECRET;
  if (envRaw == null) return null;
  let s = envRaw.trim();
  if (!s) return null;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

export function requireJwtSecret(): Uint8Array {
  const raw = normalizedAdminJwtSecret();
  const len = raw?.length ?? 0;
  if (!raw || len < MIN_SECRET_LEN) {
    throw new Error(
      `ADMIN_JWT_SECRET ausente o corto (${len} caracteres; mínimo ${MIN_SECRET_LEN}). Añádelo en backend/.env (misma clave que frontend) y reinicia el servidor.`,
    );
  }
  return new TextEncoder().encode(raw);
}

export async function signAdminSessionToken(payload: {
  sub: string;
  email: string;
}): Promise<string> {
  const key = requireJwtSecret();
  return new jose.SignJWT({ role: "admin", email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(key);
}

/**
 * Valida el JWT de sesión editorial (mismo secreto que `signAdminSessionToken`).
 * Usado por GraphQL cuando el cliente envía `Authorization: Bearer <jwt>` en lugar de `ADMIN_SECRET`.
 */
export async function verifyAdminSessionToken(token: string): Promise<boolean> {
  try {
    const key = requireJwtSecret();
    const { payload } = await jose.jwtVerify(token, key);
    return (payload as { role?: string }).role === "admin";
  } catch {
    return false;
  }
}
