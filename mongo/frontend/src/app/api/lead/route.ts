import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const backend = () => process.env.BACKEND_URL ?? "http://127.0.0.1:4000";

/** RFC 5322 simplificado: suficiente para filtrar basura antes del backend. */
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const MAX_EMAIL_LEN = 254;
const MAX_INTERESTS = 12;
const MAX_INTEREST_LEN = 64;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("email" in body)) {
    return Response.json({ ok: false, error: "Email requerido" }, { status: 400 });
  }

  const email = (body as { email: unknown }).email;
  if (typeof email !== "string") {
    return Response.json({ ok: false, error: "Email inválido" }, { status: 400 });
  }

  const trimmed = email.trim();
  if (!trimmed || trimmed.length > MAX_EMAIL_LEN) {
    return Response.json({ ok: false, error: "Email inválido" }, { status: 400 });
  }
  if (!EMAIL_RE.test(trimmed)) {
    return Response.json({ ok: false, error: "Introduce un correo válido" }, { status: 400 });
  }

  const rawSource = (body as { source?: unknown }).source;
  const source = typeof rawSource === "string" ? rawSource.slice(0, 120) : "puro-flusso-boletin";

  const rawInterests = (body as { interests?: unknown }).interests;
  const interests = Array.isArray(rawInterests)
    ? rawInterests
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim().slice(0, MAX_INTEREST_LEN))
        .filter(Boolean)
        .slice(0, MAX_INTERESTS)
    : undefined;

  const res = await fetch(`${backend()}/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trimmed, source, ...(interests?.length ? { interests } : {}) }),
  });

  const data = (await res.json()) as { ok?: boolean; error?: string };
  return Response.json(data, { status: res.ok ? 200 : res.status });
}
