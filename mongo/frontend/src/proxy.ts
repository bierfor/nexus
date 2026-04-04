import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

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

function secretKey(): Uint8Array | null {
  const raw = normalizedJwtSecret();
  if (!raw || raw.length < MIN_SECRET_LEN) return null;
  return new TextEncoder().encode(raw);
}

async function isValidSessionToken(token: string): Promise<boolean> {
  const key = secretKey();
  if (!key) return false;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return payload.role === "admin" && typeof payload.email === "string";
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const key = secretKey();

  if (pathname.startsWith("/admin/login")) {
    const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (key && token && (await isValidSessionToken(token))) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (!key) {
    const u = new URL("/admin/login", req.url);
    u.searchParams.set("config", "jwt");
    return NextResponse.redirect(u);
  }

  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  if (!(await isValidSessionToken(token))) {
    const res = NextResponse.redirect(new URL("/admin/login", req.url));
    res.cookies.delete(ADMIN_SESSION_COOKIE);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
