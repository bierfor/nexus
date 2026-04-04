import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export const runtime = "nodejs";

const backend = () => process.env.BACKEND_URL?.trim() ?? "http://127.0.0.1:4000";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }

  const res = await fetch(`${backend()}/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const json = (await res.json()) as { ok?: boolean; token?: string; error?: string };

  if (!res.ok || !json.ok || typeof json.token !== "string" || !json.token) {
    const status = res.status === 429 ? 429 : res.status === 503 ? 503 : 401;
    return NextResponse.json(
      { error: json.error ?? "Credenciales incorrectas" },
      { status },
    );
  }

  const out = NextResponse.json({ ok: true });
  out.cookies.set(ADMIN_SESSION_COOKIE, json.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return out;
}
