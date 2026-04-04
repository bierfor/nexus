import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-session";

export async function POST(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tags = Array.isArray((body as { tags?: unknown }).tags)
    ? (body as { tags: unknown[] }).tags.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];

  if (!tags.length) {
    return NextResponse.json({ error: "tags requerido" }, { status: 400 });
  }

  for (const tag of tags) {
    revalidateTag(tag, "default");
  }

  return NextResponse.json({ ok: true, invalidated: tags });
}
