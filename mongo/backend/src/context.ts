import type { PrismaClient } from "@prisma/client";

export type GraphQLContext = {
  prisma: PrismaClient;
  isAdmin: boolean;
  /** Si la petición autenticó un `BotApiToken`, su id de documento. */
  botTokenId: string | null;
  /** Scopes del token de bot (vacío si no hay bot). */
  botScopes: string[];
  viewerIp: string;
};
