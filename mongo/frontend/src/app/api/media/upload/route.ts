import type { NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { getAdminSecret } from "@/lib/adminSecret";

export const runtime = "nodejs";

const backend = () => process.env.BACKEND_URL?.trim() ?? "http://127.0.0.1:4000";

export async function POST(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session) {
    return Response.json(
      { error: "Sesión de administrador requerida. Inicia sesión en /admin/login." },
      { status: 401 },
    );
  }

  const secret = getAdminSecret();
  if (!secret) {
    return Response.json(
      { error: "ADMIN_SECRET no configurado en frontend (.env.local)" },
      { status: 503 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Archivo requerido" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const forward = new FormData();
  forward.append("file", new Blob([buffer], { type: file.type }), file.name);

  const res = await fetch(`${backend()}/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    body: forward,
  });

  const data = (await res.json()) as { error?: string; url?: string; publicId?: string };
  return Response.json(data, { status: res.status });
}
