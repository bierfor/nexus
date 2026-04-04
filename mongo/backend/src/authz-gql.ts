import { GraphQLError } from "graphql";
import type { GraphQLContext } from "./context.js";
import { hasScope } from "./scopes.js";

/** Solo sesión/proxy admin (`ADMIN_SECRET`), no tokens de bot. */
export function requireHumanAdmin(ctx: GraphQLContext) {
  if (!ctx.isAdmin) {
    throw new GraphQLError("No autorizado", { extensions: { code: "FORBIDDEN" } });
  }
}

/** Admin humano o bot con el scope indicado (o `*`). */
export function requireScope(ctx: GraphQLContext, scope: string) {
  if (!hasScope(ctx, scope)) {
    throw new GraphQLError("No autorizado", { extensions: { code: "FORBIDDEN" } });
  }
}
