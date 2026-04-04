import type { Request } from "express";

function normalizeToken(s: string): string {
  let t = s.replace(/\r/g, "").trim().replace(/^\uFEFF/, "");
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export function isAdminRequest(req: Pick<Request, "headers">): boolean {
  const envRaw = process.env.ADMIN_SECRET;
  if (envRaw == null || envRaw === "") return false;
  const secret = normalizeToken(envRaw);
  if (!secret) return false;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  const token = normalizeToken(auth.slice(7));
  return token === secret && token.length > 0;
}
