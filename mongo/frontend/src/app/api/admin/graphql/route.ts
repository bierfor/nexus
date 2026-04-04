import type { NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { getAdminSecret } from "@/lib/adminSecret";

export const runtime = "nodejs";

const backend = () => process.env.BACKEND_URL?.trim() ?? "http://127.0.0.1:4000";

export async function POST(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session) {
    return Response.json(
      {
        errors: [
          {
            message:
              "Sesión de administrador requerida. Abre /admin/login e inicia sesión (cookie httpOnly).",
          },
        ],
      },
      { status: 401 },
    );
  }

  const secret = getAdminSecret();
  if (!secret) {
    return Response.json(
      {
        errors: [
          {
            message:
              "ADMIN_SECRET no está en el servidor Next. Crea frontend/.env.local con ADMIN_SECRET=tu_token (mismo valor que en backend/.env) y reinicia npm run dev.",
          },
        ],
      },
      { status: 503 },
    );
  }

  const body = await req.text();
  const res = await fetch(`${backend()}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
