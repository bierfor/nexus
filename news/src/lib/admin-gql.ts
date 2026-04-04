/**
 * GraphQL hacia mongo/backend:
 * - Preferir JWT de cookie de admin (`pf_admin_token`) cuando hay `NexusContext` (SSR / acciones).
 * - Si no hay cookie, usar `NEXUS_ADMIN_SECRET` / `ADMIN_SECRET` (mismo valor que en el API).
 */

import type { NexusContext } from '@nexus_js/server/context';
import { getAdminTokenFromCookie } from './admin-auth.ts';

const DEFAULT_GRAPHQL = 'http://127.0.0.1:4000/graphql';

function graphqlUrl(): string {
  return process.env.NEXUS_GRAPHQL_URL?.trim() || DEFAULT_GRAPHQL;
}

/**
 * `POST` al mismo origen que GraphQL: subida a Cloudinary (`mongo/backend` `/media/upload`).
 * Opcional: `NEXUS_MEDIA_UPLOAD_URL` si el endpoint difiere del origen de `NEXUS_GRAPHQL_URL`.
 */
export function mediaUploadUrlFromEnv(): string {
  const direct = process.env.NEXUS_MEDIA_UPLOAD_URL?.trim();
  if (direct) return direct;
  const g = graphqlUrl();
  try {
    return new URL('/media/upload', new URL(g).origin).href;
  } catch {
    return 'http://127.0.0.1:4000/media/upload';
  }
}

/**
 * Same rules as mongo/backend `auth.ts` `normalizeToken` / `jwt-admin` env handling:
 * trim, strip optional surrounding quotes, strip UTF-8 BOM so Bearer matches ADMIN_SECRET.
 */
function normalizeBearerSecret(raw: string | undefined): string | null {
  if (raw == null) return null;
  let t = raw.replace(/\r/g, '').trim().replace(/^\uFEFF/, '');
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t.length > 0 ? t : null;
}

function adminSecret(): string | null {
  return (
    normalizeBearerSecret(process.env.NEXUS_ADMIN_SECRET) ||
    normalizeBearerSecret(process.env.ADMIN_SECRET)
  );
}

/** Token enviado a GraphQL: JWT de sesión admin si existe; si no, secreto compartido. */
function bearerForGraphql(ctx?: NexusContext): string | null {
  if (ctx) {
    const jwt = getAdminTokenFromCookie(ctx);
    if (jwt) return jwt;
  }
  return adminSecret();
}

async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
  ctx?: NexusContext,
): Promise<T> {
  const bearer = bearerForGraphql(ctx);
  if (!bearer) {
    throw new Error(
      'Admin GraphQL: define NEXUS_ADMIN_SECRET in news/.env (same as mongo/backend ADMIN_SECRET), or sign in so the admin session cookie is available.',
    );
  }
  const res = await fetch(graphqlUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  if (!body.data) throw new Error('Empty GraphQL response');
  return body.data;
}

const ADMIN_DASH = `
  query AdminDash {
    articles(publishedOnly: false) { id published }
    flashNewsAdminList { id published }
    heroesAdmin { id slug headline published }
    tags { id }
    authors { id }
  }
`;

export type AdminDashStats = {
  articlesTotal: number;
  articlesPublished: number;
  /** Up to 24 rows (backend cap); treat as “sample” if you need exact totals, add a count field in GraphQL. */
  flashTotal: number;
  flashPublished: number;
  heroes: number;
  tags: number;
  authors: number;
};

/** Result of loading dashboard KPIs from GraphQL (see `error` when `stats` is null). */
export type AdminDashboardStatsLoad = {
  stats: AdminDashStats | null;
  /** GraphQL/network message when KPIs could not be loaded. */
  error: string | null;
};

function formatDashLoadError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export async function fetchAdminDashboardStats(ctx?: NexusContext): Promise<AdminDashboardStatsLoad> {
  try {
    const data = await gql<{
      articles: { id: string; published: boolean }[];
      flashNewsAdminList: { id: string; published: boolean }[];
      heroesAdmin: { id: string }[];
      tags: { id: string }[];
      authors: { id: string }[];
    }>(ADMIN_DASH, undefined, ctx);
    const a = data.articles ?? [];
    const f = data.flashNewsAdminList ?? [];
    return {
      stats: {
        articlesTotal: a.length,
        articlesPublished: a.filter((x) => x.published).length,
        flashTotal: f.length,
        flashPublished: f.filter((x) => x.published).length,
        heroes: (data.heroesAdmin ?? []).length,
        tags: (data.tags ?? []).length,
        authors: (data.authors ?? []).length,
      },
      error: null,
    };
  } catch (e) {
    return { stats: null, error: formatDashLoadError(e) };
  }
}

// ── Articles (admin CRUD — same bearer as dashboard) ─────────────────────────

export type AdminArticleListRow = {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  updatedAt: string;
};

export type AdminArticleFull = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  coverImage: string | null;
  coverImageAlt: string | null;
  readTimeMinutes: number | null;
  published: boolean;
  tags: { slug: string }[];
  author: { id: string; name: string } | null;
};

export type AdminAuthorOption = { id: string; name: string };
export type AdminTagOption = { id: string; name: string; slug: string };

const Q_ARTICLES_ADMIN_LIST = `
  query ArticlesAdminList {
    articles(publishedOnly: false) {
      id
      title
      slug
      published
      updatedAt
    }
  }
`;

const Q_AUTHORS_TAGS = `
  query AuthorsTags {
    authors { id name }
    tags { id name slug }
  }
`;

const Q_ARTICLE_ADMIN = `
  query ArticleAdmin($id: ID!) {
    articleAdmin(id: $id) {
      id
      title
      slug
      excerpt
      content
      coverImage
      coverImageAlt
      readTimeMinutes
      published
      tags { slug }
      author { id name }
    }
  }
`;

const M_CREATE_ARTICLE = `
  mutation CreateArticle($input: ArticleInput!) {
    createArticle(input: $input) {
      id
      slug
      title
    }
  }
`;

const M_UPDATE_ARTICLE = `
  mutation UpdateArticle($id: ID!, $input: ArticleUpdateInput!) {
    updateArticle(id: $id, input: $input) {
      id
      slug
      title
    }
  }
`;

const M_DELETE_ARTICLE = `
  mutation DeleteArticle($id: ID!) {
    deleteArticle(id: $id)
  }
`;

const M_PUBLISH_ARTICLE = `
  mutation PublishArticle($id: ID!) {
    publishArticle(id: $id) { id }
  }
`;

const M_UNPUBLISH_ARTICLE = `
  mutation UnpublishArticle($id: ID!) {
    unpublishArticle(id: $id) { id }
  }
`;

export async function fetchArticlesAdminList(ctx?: NexusContext): Promise<AdminArticleListRow[] | null> {
  try {
    const data = await gql<{ articles: AdminArticleListRow[] }>(Q_ARTICLES_ADMIN_LIST, undefined, ctx);
    return data.articles ?? [];
  } catch {
    return null;
  }
}

export async function fetchAuthorsTagsForAdmin(ctx?: NexusContext): Promise<{
  authors: AdminAuthorOption[];
  tags: AdminTagOption[];
} | null> {
  try {
    const data = await gql<{
      authors: AdminAuthorOption[];
      tags: AdminTagOption[];
    }>(Q_AUTHORS_TAGS, undefined, ctx);
    return {
      authors: data.authors ?? [],
      tags: data.tags ?? [],
    };
  } catch {
    return null;
  }
}

export async function fetchArticleAdminById(
  id: string,
  ctx?: NexusContext,
): Promise<AdminArticleFull | null> {
  try {
    const data = await gql<{ articleAdmin: AdminArticleFull | null }>(
      Q_ARTICLE_ADMIN,
      {
        id,
      },
      ctx,
    );
    return data.articleAdmin ?? null;
  } catch {
    return null;
  }
}

export async function gqlCreateArticle(input: {
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  coverImage?: string | null;
  coverImageAlt?: string | null;
  readTimeMinutes?: number | null;
  authorId?: string | null;
  tagSlugs?: string[];
  published?: boolean;
}, ctx?: NexusContext): Promise<{ id: string; slug: string; title: string }> {
  const variables = {
    input: {
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt ?? null,
      content: input.content,
      coverImage: input.coverImage ?? null,
      coverImageAlt: input.coverImageAlt ?? null,
      readTimeMinutes: input.readTimeMinutes ?? null,
      authorId: input.authorId ?? null,
      tagSlugs: input.tagSlugs ?? [],
      published: input.published ?? false,
    },
  };
  const data = await gql<{ createArticle: { id: string; slug: string; title: string } }>(
    M_CREATE_ARTICLE,
    variables,
    ctx,
  );
  return data.createArticle;
}

export async function gqlUpdateArticle(
  id: string,
  input: {
    title?: string;
    slug?: string;
    excerpt?: string | null;
    content?: string;
    coverImage?: string | null;
    coverImageAlt?: string | null;
    readTimeMinutes?: number | null;
    authorId?: string | null;
    tagSlugs?: string[];
    published?: boolean;
  },
  ctx?: NexusContext,
): Promise<{ id: string; slug: string; title: string }> {
  const variables = {
    id,
    input: {
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt,
      content: input.content,
      coverImage: input.coverImage,
      coverImageAlt: input.coverImageAlt,
      readTimeMinutes: input.readTimeMinutes,
      authorId: input.authorId,
      tagSlugs: input.tagSlugs,
      published: input.published,
    },
  };
  const data = await gql<{ updateArticle: { id: string; slug: string; title: string } }>(
    M_UPDATE_ARTICLE,
    variables,
    ctx,
  );
  return data.updateArticle;
}

export async function gqlDeleteArticle(id: string, ctx?: NexusContext): Promise<boolean> {
  const data = await gql<{ deleteArticle: boolean }>(M_DELETE_ARTICLE, { id }, ctx);
  return data.deleteArticle;
}

export async function gqlPublishArticle(id: string, ctx?: NexusContext): Promise<void> {
  await gql<{ publishArticle: { id: string } }>(M_PUBLISH_ARTICLE, { id }, ctx);
}

export async function gqlUnpublishArticle(id: string, ctx?: NexusContext): Promise<void> {
  await gql<{ unpublishArticle: { id: string } }>(M_UNPUBLISH_ARTICLE, { id }, ctx);
}

// ── Flash news (wire) ───────────────────────────────────────────────────────

export type AdminFlashListRow = {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  updatedAt: string;
};

export type AdminFlashFull = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  hack: string | null;
  published: boolean;
  updatedAt: string;
};

const Q_FLASH_ADMIN_LIST = `
  query FlashNewsAdminList {
    flashNewsAdminList {
      id
      title
      slug
      published
      updatedAt
    }
  }
`;

const Q_FLASH_ADMIN = `
  query FlashNewsAdmin($id: ID!) {
    flashNewsAdmin(id: $id) {
      id
      title
      slug
      summary
      sourceLabel
      sourceUrl
      hack
      published
      updatedAt
    }
  }
`;

const M_CREATE_FLASH = `
  mutation CreateFlashNews($input: FlashNewsInput!) {
    createFlashNews(input: $input) {
      id
      slug
      title
    }
  }
`;

const M_UPDATE_FLASH = `
  mutation UpdateFlashNews($id: ID!, $input: FlashNewsUpdateInput!) {
    updateFlashNews(id: $id, input: $input) {
      id
      slug
      title
    }
  }
`;

const M_DELETE_FLASH = `
  mutation DeleteFlashNews($id: ID!) {
    deleteFlashNews(id: $id)
  }
`;

export async function fetchFlashNewsAdminList(ctx?: NexusContext): Promise<AdminFlashListRow[] | null> {
  try {
    const data = await gql<{ flashNewsAdminList: AdminFlashListRow[] }>(Q_FLASH_ADMIN_LIST, undefined, ctx);
    return data.flashNewsAdminList ?? [];
  } catch {
    return null;
  }
}

export async function fetchFlashAdminById(
  id: string,
  ctx?: NexusContext,
): Promise<AdminFlashFull | null> {
  try {
    const data = await gql<{ flashNewsAdmin: AdminFlashFull | null }>(Q_FLASH_ADMIN, { id }, ctx);
    return data.flashNewsAdmin ?? null;
  } catch {
    return null;
  }
}

export async function gqlCreateFlashNews(input: {
  title: string;
  slug?: string | null;
  summary: string;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  hack?: string | null;
  published?: boolean;
}, ctx?: NexusContext): Promise<{ id: string; slug: string; title: string }> {
  const raw: Record<string, unknown> = {
    title: input.title,
    summary: input.summary,
    published: input.published ?? false,
  };
  const slug = input.slug?.trim();
  if (slug) raw.slug = slug;
  if (input.sourceLabel !== undefined) raw.sourceLabel = input.sourceLabel;
  if (input.sourceUrl !== undefined) raw.sourceUrl = input.sourceUrl;
  if (input.hack !== undefined) raw.hack = input.hack;
  const data = await gql<{ createFlashNews: { id: string; slug: string; title: string } }>(
    M_CREATE_FLASH,
    { input: raw },
    ctx,
  );
  return data.createFlashNews;
}

export async function gqlUpdateFlashNews(
  id: string,
  input: {
    title?: string;
    slug?: string;
    summary?: string;
    sourceLabel?: string | null;
    sourceUrl?: string | null;
    hack?: string | null;
    published?: boolean;
  },
  ctx?: NexusContext,
): Promise<{ id: string; slug: string; title: string }> {
  const data = await gql<{ updateFlashNews: { id: string; slug: string; title: string } }>(
    M_UPDATE_FLASH,
    { id, input },
    ctx,
  );
  return data.updateFlashNews;
}

export async function gqlDeleteFlashNews(id: string, ctx?: NexusContext): Promise<boolean> {
  const data = await gql<{ deleteFlashNews: boolean }>(M_DELETE_FLASH, { id }, ctx);
  return data.deleteFlashNews;
}

// ── Hero banner blocks ──────────────────────────────────────────────────────

export type AdminHeroListRow = {
  id: string;
  slug: string;
  headline: string;
  published: boolean;
  updatedAt: string;
};

export type AdminHeroFull = {
  id: string;
  slug: string;
  kicker: string | null;
  headline: string;
  subheadline: string | null;
  body: string;
  bodySecondary: string | null;
  imageUrl: string | null;
  footerCtaLabel: string | null;
  footerCtaHref: string | null;
  published: boolean;
  updatedAt: string;
};

const Q_HEROES_ADMIN = `
  query HeroesAdmin {
    heroesAdmin {
      id
      slug
      headline
      published
      updatedAt
    }
  }
`;

const Q_HERO_ADMIN = `
  query HeroAdmin($slug: String!) {
    heroAdmin(slug: $slug) {
      id
      slug
      kicker
      headline
      subheadline
      body
      bodySecondary
      imageUrl
      footerCtaLabel
      footerCtaHref
      published
      updatedAt
    }
  }
`;

const M_UPSERT_HERO = `
  mutation UpsertHero($input: HeroUpsertInput!) {
    upsertHero(input: $input) {
      slug
      headline
    }
  }
`;

const M_DELETE_HERO = `
  mutation DeleteHero($slug: String!) {
    deleteHero(slug: $slug)
  }
`;

export async function fetchHeroesAdminList(ctx?: NexusContext): Promise<AdminHeroListRow[] | null> {
  try {
    const data = await gql<{ heroesAdmin: AdminHeroListRow[] }>(Q_HEROES_ADMIN, undefined, ctx);
    return data.heroesAdmin ?? [];
  } catch {
    return null;
  }
}

export async function fetchHeroAdminBySlug(
  slug: string,
  ctx?: NexusContext,
): Promise<AdminHeroFull | null> {
  try {
    const data = await gql<{ heroAdmin: AdminHeroFull | null }>(Q_HERO_ADMIN, { slug }, ctx);
    return data.heroAdmin ?? null;
  } catch {
    return null;
  }
}

export async function gqlUpsertHero(input: {
  slug: string;
  kicker?: string | null;
  headline: string;
  subheadline?: string | null;
  body: string;
  bodySecondary?: string | null;
  imageUrl?: string | null;
  footerCtaLabel?: string | null;
  footerCtaHref?: string | null;
  published?: boolean;
}, ctx?: NexusContext): Promise<{ slug: string; headline: string }> {
  const variables = {
    input: {
      slug: input.slug,
      kicker: input.kicker ?? null,
      headline: input.headline,
      subheadline: input.subheadline ?? null,
      body: input.body,
      bodySecondary: input.bodySecondary ?? null,
      imageUrl: input.imageUrl ?? null,
      footerCtaLabel: input.footerCtaLabel ?? null,
      footerCtaHref: input.footerCtaHref ?? null,
      published: input.published ?? true,
    },
  };
  const data = await gql<{ upsertHero: { slug: string; headline: string } }>(
    M_UPSERT_HERO,
    variables,
    ctx,
  );
  return data.upsertHero;
}

export async function gqlDeleteHero(slug: string, ctx?: NexusContext): Promise<boolean> {
  const data = await gql<{ deleteHero: boolean }>(M_DELETE_HERO, { slug }, ctx);
  return data.deleteHero;
}
