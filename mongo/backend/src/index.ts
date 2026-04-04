import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import http from "node:http";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(backendRoot, ".env") });
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@as-integrations/express5";
import cors from "cors";
import express from "express";
import multer from "multer";
import { prisma } from "./db.js";
import { typeDefs } from "./typeDefs.js";
import { resolvers } from "./resolvers.js";
import type { GraphQLContext } from "./context.js";
import { authorizeMediaUpload, resolveGraphQLAuth } from "./graphql-auth.js";
import { createFlashNewsFromBody } from "./create-flash-news.js";
import { parseIntegrationFlashRequestBody } from "./integration-flash-http.js";
import { hasScope } from "./scopes.js";
import { postAdminLogin } from "./admin-login-route.js";
import { clientIp } from "./client-ip.js";
import { uploadImageBuffer } from "./cloudinary.js";
import { buildCorsOptions } from "./cors-config.js";

const app = express();
const httpServer = http.createServer(app);
app.set("trust proxy", 1);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Solo se permiten imágenes"));
      return;
    }
    cb(null, true);
  },
});

const server = new ApolloServer<GraphQLContext>({
  typeDefs,
  resolvers,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});

await server.start();

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "puro-flusso-api" });
});

/** Evita 404 al abrir la URL del host en el navegador (p. ej. Railway). */
app.get("/", (_req, res) => {
  res.status(200).json({
    service: "puro-flusso-api",
    graphql: "/graphql",
    integrationsFlashNews: "POST /integrations/flash-news",
    health: "/health",
    hint: "En el front: BACKEND_URL = origen de esta petición (https, sin barra final). NEXT_PUBLIC_GRAPHQL_URL = mismo origen + /graphql",
  });
});

app.use(cors(buildCorsOptions()));

/**
 * Debe ir ANTES de express.json(): así leemos el body como Buffer y aceptamos
 * JSON aunque falte Content-Type o venga string doblemente escapado (agentes).
 * Si el POST trae el objeto del tool con `cuerpo_json_flash`, lo desempaquetamos.
 */
app.post(
  "/integrations/flash-news",
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    try {
      const auth = await resolveGraphQLAuth(req, prisma);
      if (!hasScope({ isAdmin: auth.isAdmin, botScopes: auth.botScopes }, "flash:create")) {
        res.status(401).json({ error: "No autorizado" });
        return;
      }
      const parsed = parseIntegrationFlashRequestBody(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const result = await createFlashNewsFromBody(prisma, parsed.payload);
      if (!result.ok) {
        res.status(result.status).json({ error: result.message });
        return;
      }
      const f = result.flash;
      res.status(201).json({
        id: f.id,
        slug: f.slug,
        title: f.title,
        summary: f.summary,
        published: f.published,
        publishedAt: f.publishedAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Error interno" });
    }
  },
);

app.use(express.json({ limit: "2mb" }));

app.post("/auth/admin/login", (req, res, next) => {
  void postAdminLogin(req, res).catch(next);
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeInterestSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const s = x.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (s && s.length <= 48) out.push(s);
  }
  return [...new Set(out)].slice(0, 20);
}

function mergeInterestCsv(existing: string | null | undefined, add: string[]): string | null {
  const prev = (existing ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...prev, ...add])];
  if (!merged.length) return null;
  const s = merged.slice(0, 32).join(",");
  return s.length > 1800 ? s.slice(0, 1800) : s;
}

app.post("/leads", async (req, res) => {
  try {
    const raw = req.body?.email;
    if (typeof raw !== "string") {
      res.status(400).json({ ok: false, error: "Email requerido" });
      return;
    }
    const email = raw.trim().toLowerCase();
    if (!emailRegex.test(email)) {
      res.status(400).json({ ok: false, error: "Email no válido" });
      return;
    }
    const source =
      typeof req.body?.source === "string" ? req.body.source.slice(0, 120) : "puro-flusso-boletin";
    const topicSlugs = normalizeInterestSlugs(req.body?.interests);
    const existing = await prisma.lead.findUnique({
      where: { email },
      select: { interests: true },
    });
    const interestsCreate = topicSlugs.length > 0 ? topicSlugs.join(",") : null;
    const interestsUpdate =
      topicSlugs.length > 0 ? mergeInterestCsv(existing?.interests, topicSlugs) : undefined;

    await prisma.lead.upsert({
      where: { email },
      create: { email, source, interests: interestsCreate },
      update: interestsUpdate !== undefined ? { interests: interestsUpdate } : {},
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "No se pudo guardar" });
  }
});

app.post(
  "/media/upload",
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!(await authorizeMediaUpload(req, prisma))) {
        res.status(401).json({ error: "No autorizado" });
        return;
      }
      if (!req.file?.buffer) {
        res.status(400).json({ error: "Campo file requerido" });
        return;
      }
      const { url, publicId } = await uploadImageBuffer(req.file.buffer, req.file.originalname);
      res.json({ url, publicId });
    } catch (e) {
      next(e);
    }
  },
);

app.use(
  "/graphql",
  expressMiddleware(server, {
    context: async ({ req }): Promise<GraphQLContext> => {
      const auth = await resolveGraphQLAuth(req, prisma);
      return {
        prisma,
        isAdmin: auth.isAdmin,
        botTokenId: auth.botTokenId,
        botScopes: auth.botScopes,
        viewerIp: clientIp(req),
      };
    },
  }),
);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Error interno";
  res.status(500).json({ error: message });
});

const port = Number(process.env.PORT) || 4000;

await new Promise<void>((resolve) => {
  httpServer.listen(port, () => resolve());
});

console.log(
  `Puro Flusso API: GET /health · GraphQL http://localhost:${port}/graphql · POST /integrations/flash-news · POST /auth/admin/login · POST /leads · POST /media/upload`,
);
