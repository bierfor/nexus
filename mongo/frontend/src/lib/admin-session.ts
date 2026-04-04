import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

export const ADMIN_SESSION_COOKIE = "pf_admin_session";

const MIN_SECRET_LEN = 32;

function normalizedJwtSecret(): string | null {
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

function jwtSecretKey(): Uint8Array | null {
  const raw = normalizedJwtSecret();
  if (!raw || raw.length < MIN_SECRET_LEN) return null;
  return new TextEncoder().encode(raw);
}

export type AdminSessionPayload = {
  sub: string;
  email: string;
};

export async function verifyAdminSessionToken(
  token: string,
): Promise<AdminSessionPayload | null> {
  const key = jwtSecretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.role !== "admin" || typeof payload.email !== "string") return null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    return { sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function getAdminSession(req: NextRequest): Promise<AdminSessionPayload | null> {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminSessionToken(token);
}
