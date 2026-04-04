import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "./context.js";
import type {
  Article as ArticleModel,
  BotApiToken as BotApiTokenModel,
  FlashNews as FlashNewsModel,
  Hero as HeroModel,
  Tag as TagModel,
} from "@prisma/client";
import { requireHumanAdmin, requireScope } from "./authz-gql.js";
import { BOT_AVAILABLE_SCOPES, normalizeBotScopes } from "./scopes.js";
import { defaultTagDisplayNameFromSlug, normalizeTagSlugList } from "./tag-slug.js";
import { allowArticleViewIncrement } from "./view-throttle.js";
import { createFlashNewsFromBody } from "./create-flash-news.js";

type ArticleLoaded = ArticleModel & {
  author: { id: string; name: string; bio: string | null; avatarUrl: string | null } | null;
  tagLinks: { tag: TagModel }[];
};

const articleInclude = {
  author: true,
  tagLinks: { include: { tag: true } },
} as const;

function isPrismaUniqueError(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002");
}

function optStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function flashNewsDelegate(prisma: GraphQLContext["prisma"]) {
  const delegate = (prisma as unknown as { flashNews?: unknown }).flashNews as
    | {
        findMany: (...args: unknown[]) => Promise<unknown>;
        findUnique: (...args: unknown[]) => Promise<unknown>;
        create: (...args: unknown[]) => Promise<unknown>;
        update: (...args: unknown[]) => Promise<unknown>;
        delete: (...args: unknown[]) => Promise<unknown>;
      }
    | undefined;
  if (!delegate) {
    throw new GraphQLError(
      "FlashNews no disponible en Prisma Client. Ejecuta `npm run db:push` y reinicia el backend.",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }
  return delegate;
}

/** Admin: enlaza slugs creando la fila Tag si aún no existe. */
async function ensureTagIdsBySlug(
  prisma: GraphQLContext["prisma"],
  slugs: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const slug of slugs) {
    let row = await prisma.tag.findUnique({ where: { slug } });
    if (row) {
      ids.push(row.id);
      continue;
    }
    const displayName = defaultTagDisplayNameFromSlug(slug);
    try {
      row = await prisma.tag.create({ data: { slug, name: displayName } });
    } catch (e: unknown) {
      if (!isPrismaUniqueError(e)) throw e;
      row = await prisma.tag.findUnique({ where: { slug } });
      if (!row) {
        try {
          row = await prisma.tag.create({ data: { slug, name: slug } });
        } catch (e2: unknown) {
          if (!isPrismaUniqueError(e2)) throw e2;
          row = await prisma.tag.findUniqueOrThrow({ where: { slug } });
        }
      }
    }
    ids.push(row.id);
  }
  return ids;
}

export const resolvers = {
  Query: {
    articles: async (
      _: unknown,
      args: { publishedOnly?: boolean | null },
      ctx: GraphQLContext,
    ) => {
      const onlyPublished = args.publishedOnly !== false;
      if (!onlyPublished) {
        requireScope(ctx, "article:list");
      }
      return ctx.prisma.article.findMany({
        where: onlyPublished ? { published: true } : undefined,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        include: articleInclude,
      });
    },

    article: async (_: unknown, args: { slug: string }, { prisma }: GraphQLContext) => {
      return prisma.article.findFirst({
        where: { slug: args.slug, published: true },
        include: articleInclude,
      });
    },

    articleDraft: async (_: unknown, args: { slug: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "article:read");
      return ctx.prisma.article.findFirst({
        where: { slug: args.slug },
        include: articleInclude,
      });
    },

    articleAdmin: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "article:read");
      return ctx.prisma.article.findUnique({
        where: { id: args.id },
        include: articleInclude,
      });
    },

    tags: async (_: unknown, __: unknown, { prisma }: GraphQLContext) => {
      return prisma.tag.findMany({ orderBy: { name: "asc" } });
    },

    authors: async (_: unknown, __: unknown, { prisma }: GraphQLContext) => {
      return prisma.author.findMany({ orderBy: { name: "asc" } });
    },

    hero: async (_: unknown, args: { slug: string }, { prisma }: GraphQLContext) => {
      const slug = args.slug.trim();
      if (!slug) return null;
      return prisma.hero.findFirst({
        where: { slug, published: true },
      });
    },

    heroPreview: async (
      _: unknown,
      args: { slug: string; previewToken: string },
      { prisma }: GraphQLContext,
    ) => {
      const expected = process.env.HERO_PREVIEW_TOKEN?.trim();
      if (!expected || args.previewToken !== expected) {
        throw new GraphQLError("Vista previa no autorizada", { extensions: { code: "FORBIDDEN" } });
      }
      const slug = args.slug.trim();
      if (!slug) return null;
      return prisma.hero.findUnique({ where: { slug } });
    },

    /** Draft hero by slug — same auth as `articleAdmin` (Bearer ADMIN_SECRET or article:read). */
    heroAdmin: async (_: unknown, args: { slug: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "article:read");
      const slug = args.slug.trim();
      if (!slug) return null;
      return ctx.prisma.hero.findUnique({ where: { slug } });
    },

    /** All hero rows — same auth as unpublished `articles` list (`article:list`). */
    heroesAdmin: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      requireScope(ctx, "article:list");
      return ctx.prisma.hero.findMany({ orderBy: { slug: "asc" } });
    },

    flashNewsAdminList: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      requireScope(ctx, "flash:list");
      const flash = flashNewsDelegate(ctx.prisma);
      return flash.findMany({
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      });
    },

    flashNews: async (
      _: unknown,
      args: { publishedOnly?: boolean | null; limit?: number | null },
      ctx: GraphQLContext,
    ) => {
      const onlyPublished = args.publishedOnly !== false;
      if (!onlyPublished) {
        requireScope(ctx, "flash:list");
      }
      const take = Math.min(Math.max(args.limit ?? 6, 1), 24);
      const flash = flashNewsDelegate(ctx.prisma);
      return flash.findMany({
        where: onlyPublished ? { published: true } : undefined,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take,
      });
    },

    flashNewsAdmin: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "flash:read");
      return flashNewsDelegate(ctx.prisma).findUnique({ where: { id: args.id } });
    },

    botApiTokens: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      requireHumanAdmin(ctx);
      return ctx.prisma.botApiToken.findMany({ orderBy: { createdAt: "desc" } });
    },

    botAvailableScopes: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      requireHumanAdmin(ctx);
      return [...BOT_AVAILABLE_SCOPES];
    },
  },

  Mutation: {
    createArticle: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) => {
      requireScope(ctx, "article:create");
      const tagSlugsRaw = input.tagSlugs as string[] | undefined;
      const tagSlugs =
        tagSlugsRaw && tagSlugsRaw.length > 0 ? normalizeTagSlugList(tagSlugsRaw) : [];
      const tagIds =
        tagSlugs.length > 0 ? await ensureTagIdsBySlug(ctx.prisma, tagSlugs) : [];
      const published = (input.published as boolean | undefined) ?? false;
      try {
        return await ctx.prisma.article.create({
          data: {
            title: input.title as string,
            slug: input.slug as string,
            excerpt: (input.excerpt as string | undefined) ?? null,
            content: input.content as string,
            coverImage: (input.coverImage as string | undefined) ?? null,
            coverImageAlt: optStr(input.coverImageAlt as string | undefined),
            readTimeMinutes: (input.readTimeMinutes as number | undefined) ?? null,
            published,
            publishedAt: published ? new Date() : null,
            authorId: (input.authorId as string | undefined) ?? null,
            tagLinks:
              tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
          },
          include: articleInclude,
        });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
          throw new GraphQLError("Ya existe un artículo con ese slug");
        }
        throw e;
      }
    },

    updateArticle: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) => {
      requireScope(ctx, "article:update");
      const data: Prisma.ArticleUpdateInput = {};
      if (input.title !== undefined) data.title = input.title as string;
      if (input.slug !== undefined) data.slug = input.slug as string;
      if (input.excerpt !== undefined) data.excerpt = (input.excerpt as string | null) ?? null;
      if (input.content !== undefined) data.content = input.content as string;
      if (input.coverImage !== undefined) {
        data.coverImage = (input.coverImage as string | null) ?? null;
      }
      if (input.coverImageAlt !== undefined) {
        data.coverImageAlt = optStr(input.coverImageAlt as string | undefined);
      }
      if (input.readTimeMinutes !== undefined) {
        data.readTimeMinutes = (input.readTimeMinutes as number | null) ?? null;
      }
      if (input.authorId !== undefined) {
        const aid = input.authorId as string | null;
        data.author = aid ? { connect: { id: aid } } : { disconnect: true };
      }
      if (input.published !== undefined) {
        const pub = input.published as boolean;
        data.published = pub;
        if (!pub) {
          data.publishedAt = null;
        } else {
          const existing = await ctx.prisma.article.findUnique({
            where: { id },
            select: { published: true, publishedAt: true },
          });
          if (existing && !existing.published) {
            data.publishedAt = new Date();
          }
        }
      }

      try {
        await ctx.prisma.article.update({
          where: { id },
          data,
        });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
          throw new GraphQLError("Ya existe un artículo con ese slug");
        }
        throw e;
      }

      if (input.tagSlugs !== undefined) {
        const slugs = normalizeTagSlugList(input.tagSlugs as string[]);
        const tagIds = slugs.length > 0 ? await ensureTagIdsBySlug(ctx.prisma, slugs) : [];
        await ctx.prisma.tagsOnArticles.deleteMany({ where: { articleId: id } });
        if (tagIds.length > 0) {
          await ctx.prisma.tagsOnArticles.createMany({
            data: tagIds.map((tagId) => ({ articleId: id, tagId })),
          });
        }
      }

      return ctx.prisma.article.findUniqueOrThrow({
        where: { id },
        include: articleInclude,
      });
    },

    deleteArticle: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "article:delete");
      await ctx.prisma.tagsOnArticles.deleteMany({ where: { articleId: id } });
      await ctx.prisma.article.delete({ where: { id } });
      return true;
    },

    publishArticle: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "article:publish");
      return ctx.prisma.article.update({
        where: { id },
        data: { published: true, publishedAt: new Date() },
        include: articleInclude,
      });
    },

    unpublishArticle: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "article:unpublish");
      return ctx.prisma.article.update({
        where: { id },
        data: { published: false, publishedAt: null },
        include: articleInclude,
      });
    },

    upsertHero: async (_: unknown, { input }: { input: Record<string, unknown> }, ctx: GraphQLContext) => {
      requireHumanAdmin(ctx);
      const slug = String(input.slug ?? "").trim();
      if (!slug) throw new GraphQLError("slug obligatorio");
      const headline = String(input.headline ?? "").trim();
      const body = String(input.body ?? "").trim();
      if (!headline) throw new GraphQLError("headline obligatorio");
      if (!body) throw new GraphQLError("body obligatorio");

      const data = {
        kicker: optStr(input.kicker as string | undefined),
        headline,
        subheadline: optStr(input.subheadline as string | undefined),
        body,
        bodySecondary: optStr(input.bodySecondary as string | undefined),
        imageUrl: optStr(input.imageUrl as string | undefined),
        footerCtaLabel: optStr(input.footerCtaLabel as string | undefined),
        footerCtaHref: optStr(input.footerCtaHref as string | undefined),
        published: (input.published as boolean | undefined) ?? true,
      };

      return ctx.prisma.hero.upsert({
        where: { slug },
        create: { slug, ...data },
        update: data,
      });
    },

    deleteHero: async (_: unknown, { slug }: { slug: string }, ctx: GraphQLContext) => {
      requireHumanAdmin(ctx);
      const s = String(slug ?? "").trim();
      if (!s) throw new GraphQLError("slug obligatorio");
      await ctx.prisma.hero.delete({ where: { slug: s } });
      return true;
    },

    recordArticleView: async (_: unknown, { slug }: { slug: string }, ctx: GraphQLContext) => {
      const s = slug.trim();
      if (!s) throw new GraphQLError("Slug inválido");

      const found = await ctx.prisma.article.findFirst({
        where: { slug: s, published: true },
        select: { id: true, viewCount: true },
      });
      if (!found) throw new GraphQLError("Artículo no encontrado");

      if (!allowArticleViewIncrement(ctx.viewerIp, s)) {
        return found.viewCount;
      }

      const updated = await ctx.prisma.article.update({
        where: { id: found.id },
        data: { viewCount: { increment: 1 } },
        select: { viewCount: true },
      });
      return updated.viewCount;
    },

    createFlashNews: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) => {
      requireScope(ctx, "flash:create");
      const result = await createFlashNewsFromBody(ctx.prisma, input);
      if (!result.ok) {
        throw new GraphQLError(result.message);
      }
      return result.flash;
    },

    updateFlashNews: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) => {
      requireScope(ctx, "flash:update");
      const data: Prisma.FlashNewsUpdateInput = {};
      if (input.title !== undefined) data.title = String(input.title);
      if (input.slug !== undefined) data.slug = String(input.slug);
      if (input.summary !== undefined) data.summary = String(input.summary);
      if (input.sourceLabel !== undefined) data.sourceLabel = optStr(input.sourceLabel as string | undefined);
      if (input.sourceUrl !== undefined) data.sourceUrl = optStr(input.sourceUrl as string | undefined);
      if (input.hack !== undefined) data.hack = optStr(input.hack as string | undefined);
      if (input.published !== undefined) {
        const pub = Boolean(input.published);
        data.published = pub;
        if (!pub) {
          data.publishedAt = null;
        } else {
          const existing = (await flashNewsDelegate(ctx.prisma).findUnique({
            where: { id },
            select: { published: true, publishedAt: true },
          })) as { published: boolean; publishedAt: Date | null } | null;
          if (existing && !existing.published) data.publishedAt = new Date();
        }
      }
      try {
        return await flashNewsDelegate(ctx.prisma).update({ where: { id }, data });
      } catch (e: unknown) {
        if (isPrismaUniqueError(e)) throw new GraphQLError("Ya existe una flash con ese slug");
        throw e;
      }
    },

    deleteFlashNews: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "flash:delete");
      await flashNewsDelegate(ctx.prisma).delete({ where: { id } });
      return true;
    },

    publishFlashNews: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "flash:publish");
      return flashNewsDelegate(ctx.prisma).update({
        where: { id },
        data: { published: true, publishedAt: new Date() },
      });
    },

    unpublishFlashNews: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireScope(ctx, "flash:unpublish");
      return flashNewsDelegate(ctx.prisma).update({
        where: { id },
        data: { published: false, publishedAt: null },
      });
    },

    createBotApiToken: async (
      _: unknown,
      { input }: { input: { name: string; scopes: string[] } },
      ctx: GraphQLContext,
    ) => {
      requireHumanAdmin(ctx);
      const name = String(input.name ?? "").trim();
      if (!name) throw new GraphQLError("Nombre obligatorio");
      const scopes = normalizeBotScopes(input.scopes ?? []);
      if (scopes.length === 0) {
        throw new GraphQLError("Indica al menos un permiso (scope) válido");
      }
      const keyId = randomBytes(8).toString("hex");
      const secret = randomBytes(32).toString("hex");
      const token = `pfbot_${keyId}.${secret}`;
      const secretHash = await bcrypt.hash(secret, 12);
      const botApiToken = await ctx.prisma.botApiToken.create({
        data: { name, keyId, secretHash, scopes },
      });
      return { token, botApiToken };
    },

    updateBotApiToken: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) => {
      requireHumanAdmin(ctx);
      const data: Prisma.BotApiTokenUpdateInput = {};
      if (input.name !== undefined) {
        const n = String(input.name ?? "").trim();
        if (!n) throw new GraphQLError("Nombre inválido");
        data.name = n;
      }
      if (input.scopes !== undefined) {
        const scopes = normalizeBotScopes(input.scopes as string[]);
        if (scopes.length === 0) throw new GraphQLError("Indica al menos un permiso válido");
        data.scopes = scopes;
      }
      if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);
      try {
        return await ctx.prisma.botApiToken.update({ where: { id }, data });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
          throw new GraphQLError("Token no encontrado");
        }
        throw e;
      }
    },

    revokeBotApiToken: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireHumanAdmin(ctx);
      try {
        await ctx.prisma.botApiToken.delete({ where: { id } });
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
          throw new GraphQLError("Token no encontrado");
        }
        throw e;
      }
      return true;
    },
  },

  Hero: {
    updatedAt: (parent: HeroModel) => parent.updatedAt.toISOString(),
  },

  BotApiToken: {
    createdAt: (parent: BotApiTokenModel) => parent.createdAt.toISOString(),
    updatedAt: (parent: BotApiTokenModel) => parent.updatedAt.toISOString(),
    lastUsedAt: (parent: BotApiTokenModel) => parent.lastUsedAt?.toISOString() ?? null,
  },

  FlashNews: {
    publishedAt: (parent: FlashNewsModel) => parent.publishedAt?.toISOString() ?? null,
    createdAt: (parent: FlashNewsModel) => parent.createdAt.toISOString(),
    updatedAt: (parent: FlashNewsModel) => parent.updatedAt.toISOString(),
  },

  Article: {
    publishedAt: (parent: ArticleLoaded) => parent.publishedAt?.toISOString() ?? null,
    createdAt: (parent: ArticleLoaded) => parent.createdAt.toISOString(),
    updatedAt: (parent: ArticleLoaded) => parent.updatedAt.toISOString(),
    viewCount: (parent: ArticleLoaded) => parent.viewCount ?? 0,
    tags: (parent: ArticleLoaded) => parent.tagLinks.map((l) => l.tag),
    author: (parent: ArticleLoaded) => parent.author,
  },
};
