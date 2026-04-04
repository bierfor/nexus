import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";

/** 200 siempre: comprobar sesión sin “401” en consola del navegador (no autenticado ≠ error HTTP). */
export async function GET(req: NextRequest) {
  const session = await getAdminSession(req);
  return NextResponse.json({ email: session?.email ?? null });
}
