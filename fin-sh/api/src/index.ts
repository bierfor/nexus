/**
 * Fin.sh GraphQL API — Apollo Server + MongoDB.
 * Run after MongoDB is up: docker compose up -d (fin-sh) or local :27017
 */

import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import type { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { connectDb } from './db.js';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import type { GqlContext } from './resolvers.js';
import type { IncomingMessage } from 'node:http';
import { getUserFromRequest, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './auth.js';
import { runSeed } from './seed.js';
import { stripeWebhookRoute } from './stripe-webhook-route.js';

const port = Number(process.env['PORT'] ?? 4000);

const isProd = process.env['NODE_ENV'] === 'production';
const corsStrict = process.env['FIN_SH_CORS_STRICT'] === '1';

/** In development, reflect the request Origin so LAN IPs, alternate ports, and previews work. */
const corsOrigin =
  !isProd && !corsStrict
    ? true
    : (() => {
        const corsRaw =
          process.env['FIN_SH_CORS_ORIGIN'] ??
          'http://127.0.0.1:3050,http://localhost:3050';
        if (corsRaw === 'true' || corsRaw === '*') return true;
        return corsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      })();

const sessionCookiePlugin: ApolloServerPlugin<GqlContext> = {
  async requestDidStart(): Promise<GraphQLRequestListener<GqlContext>> {
    return {
      async willSendResponse(requestContext) {
        const ctx = requestContext.contextValue;
        const headers = requestContext.response.http.headers;
        if (ctx.cookieState.setSession) {
          const v = encodeURIComponent(ctx.cookieState.setSession);
          headers.set(
            'set-cookie',
            `${SESSION_COOKIE}=${v}; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}; HttpOnly; SameSite=Lax`,
          );
        } else if (ctx.cookieState.clearSession) {
          headers.set(
            'set-cookie',
            `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
          );
        }
      },
    };
  },
};

async function main(): Promise<void> {
  await connectDb();
  await runSeed();

  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer<GqlContext>({
    typeDefs,
    resolvers,
    introspection: true,
    plugins: [sessionCookiePlugin, ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  await server.start();

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
    express.json({ limit: '10mb' }),
    expressMiddleware(server, {
      context: async ({
        req,
      }: {
        req: IncomingMessage;
      }): Promise<GqlContext> => {
        const user = await getUserFromRequest(req);
        return {
          req,
          user,
          cookieState: { clearSession: false },
        };
      },
    }),
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(port, resolve);
  });

  console.log(`[fin-sh-api] Apollo ready at http://localhost:${port}/graphql`);
  console.log(`[fin-sh-api] Stripe webhook POST http://localhost:${port}/stripe/webhook`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
