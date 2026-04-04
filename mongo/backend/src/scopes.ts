/** Scopes asignables a tokens de bot (excluye `*`, que se valida aparte). */
export const BOT_AVAILABLE_SCOPES = [
  "flash:list",
  "flash:read",
  "flash:create",
  "flash:update",
  "flash:delete",
  "flash:publish",
  "flash:unpublish",
  "article:list",
  "article:read",
  "article:create",
  "article:update",
  "article:delete",
  "article:publish",
  "article:unpublish",
  "media:upload",
] as const;

export type BotAvailableScope = (typeof BOT_AVAILABLE_SCOPES)[number];

const SET = new Set<string>(BOT_AVAILABLE_SCOPES);

export function isValidBotScope(s: string): boolean {
  return s === "*" || SET.has(s);
}

export function normalizeBotScopes(scopes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of scopes) {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s || !isValidBotScope(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function hasScope(
  ctx: { isAdmin: boolean; botScopes: string[] },
  scope: string,
): boolean {
  if (ctx.isAdmin) return true;
  if (ctx.botScopes.includes("*")) return true;
  return ctx.botScopes.includes(scope);
}
