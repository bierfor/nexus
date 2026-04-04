import type { Request } from "express";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { isAdminRequest } from "./auth.js";
import { verifyAdminSessionToken } from "./jwt-admin.js";
import { hasScope } from "./scopes.js";

export type ResolvedGraphQLAuth = {
  isAdmin: boolean;
  botTokenId: string | null;
  botScopes: string[];
};

const PF_BOT = /^pfbot_([a-f0-9]{8,32})\.([a-f0-9]{32,128})$/i;

function bearerRaw(req: Pick<Request, "headers">): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  let t = auth.slice(7).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t || null;
}

export async function resolveGraphQLAuth(
  req: Pick<Request, "headers">,
  prisma: PrismaClient,
): Promise<ResolvedGraphQLAuth> {
  if (isAdminRequest(req)) {
    return { isAdmin: true, botTokenId: null, botScopes: [] };
  }

  const raw = bearerRaw(req);
  if (!raw) {
    return { isAdmin: false, botTokenId: null, botScopes: [] };
  }

  if (await verifyAdminSessionToken(raw)) {
    return { isAdmin: true, botTokenId: null, botScopes: [] };
  }

  const m = raw.match(PF_BOT);
  if (!m) {
    return { isAdmin: false, botTokenId: null, botScopes: [] };
  }

  const keyId = m[1]!.toLowerCase();
  const secret = m[2]!;

  const row = await prisma.botApiToken.findUnique({
    where: { keyId },
    select: { id: true, secretHash: true, scopes: true, enabled: true },
  });

  if (!row || !row.enabled) {
    return { isAdmin: false, botTokenId: null, botScopes: [] };
  }

  const ok = await bcrypt.compare(secret, row.secretHash);
  if (!ok) {
    return { isAdmin: false, botTokenId: null, botScopes: [] };
  }

  void prisma.botApiToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    isAdmin: false,
    botTokenId: row.id,
    botScopes: row.scopes ?? [],
  };
}

/** POST /media/upload: admin Bearer o token de bot con scope `media:upload`. */
export async function authorizeMediaUpload(
  req: Pick<Request, "headers">,
  prisma: PrismaClient,
): Promise<boolean> {
  if (isAdminRequest(req)) return true;
  const auth = await resolveGraphQLAuth(req, prisma);
  return hasScope(auth, "media:upload");
}
