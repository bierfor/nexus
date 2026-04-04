/**
 * GraphQL client for the mongo/backend API (Puro Flusso — Prisma + MongoDB).
 * Set NEXUS_GRAPHQL_URL in .env (see .env.example). Default: http://127.0.0.1:4000/graphql
 */

const DEFAULT_GRAPHQL = 'http://127.0.0.1:4000/graphql';

export type CmsArticleListItem = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: string | null;
  readTimeMinutes: number | null;
  coverImage: string | null;
  coverImageAlt: string | null;
  author: { id: string; name: string } | null;
  tags: { slug: string; name: string }[];
};

export type CmsArticleDetail = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  publishedAt: string | null;
  readTimeMinutes: number | null;
  coverImage: string | null;
  coverImageAlt: string | null;
  author: { id: string; name: string; bio: string | null; avatarUrl: string | null } | null;
  tags: { name: string; slug: string }[];
};

export type CmsHero = {
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
};

export type CmsFlashNews = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  hack: string | null;
  publishedAt: string | null;
};

export type CmsTag = {
  id: string;
  name: string;
  slug: string;
};

export type CmsAuthor = {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
};

function graphqlUrl(): string {
  return process.env.NEXUS_GRAPHQL_URL?.trim() || DEFAULT_GRAPHQL;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(graphqlUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

const ARTICLES_LIST = `
  query NewsArticles {
    articles(publishedOnly: true) {
      id
      title
      slug
      excerpt
      publishedAt
      readTimeMinutes
      coverImage
      coverImageAlt
      author { id name }
      tags { slug name }
    }
  }
`;

const ARTICLE_BY_SLUG = `
  query NewsArticle($slug: String!) {
    article(slug: $slug) {
      id
      title
      slug
      excerpt
      content
      publishedAt
      readTimeMinutes
      coverImage
      coverImageAlt
      author { id name bio avatarUrl }
      tags { name slug }
    }
  }
`;

const HERO = `
  query HeroBlock($slug: String!) {
    hero(slug: $slug) {
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
    }
  }
`;

const FLASH_LIST = `
  query FlashWire($limit: Int!) {
    flashNews(publishedOnly: true, limit: $limit) {
      id
      title
      slug
      summary
      sourceLabel
      sourceUrl
      hack
      publishedAt
    }
  }
`;

const TAGS = `
  query AllTags {
    tags {
      id
      name
      slug
    }
  }
`;

const AUTHORS = `
  query AllAuthors {
    authors {
      id
      name
      bio
      avatarUrl
    }
  }
`;

const RECORD_VIEW = `
  mutation RecordArticleView($slug: String!) {
    recordArticleView(slug: $slug)
  }
`;

export async function fetchPublishedArticles(): Promise<CmsArticleListItem[]> {
  try {
    const data = await gql<{ articles: CmsArticleListItem[] }>(ARTICLES_LIST);
    return data.articles ?? [];
  } catch {
    return [];
  }
}

export async function fetchArticleBySlug(slug: string): Promise<CmsArticleDetail | null> {
  if (!slug?.trim()) return null;
  try {
    const data = await gql<{ article: CmsArticleDetail | null }>(ARTICLE_BY_SLUG, { slug: slug.trim() });
    return data.article ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget view counter (IP-throttled on the backend). */
export function recordArticleView(slug: string): void {
  if (!slug?.trim()) return;
  void gql<{ recordArticleView: number }>(RECORD_VIEW, { slug: slug.trim() }).catch(() => {
    /* ignore */
  });
}

export async function fetchHero(slug: string): Promise<CmsHero | null> {
  const s = slug?.trim();
  if (!s) return null;
  try {
    const data = await gql<{ hero: CmsHero | null }>(HERO, { slug: s });
    return data.hero ?? null;
  } catch {
    return null;
  }
}

export async function fetchFlashNews(limit = 12): Promise<CmsFlashNews[]> {
  try {
    const data = await gql<{ flashNews: CmsFlashNews[] }>(FLASH_LIST, { limit });
    return data.flashNews ?? [];
  } catch {
    return [];
  }
}

export async function fetchFlashBySlug(slug: string): Promise<CmsFlashNews | null> {
  const s = slug?.trim();
  if (!s) return null;
  const list = await fetchFlashNews(80);
  return list.find((f) => f.slug === s) ?? null;
}

export async function fetchTags(): Promise<CmsTag[]> {
  try {
    const data = await gql<{ tags: CmsTag[] }>(TAGS);
    return data.tags ?? [];
  } catch {
    return [];
  }
}

export async function fetchAuthors(): Promise<CmsAuthor[]> {
  try {
    const data = await gql<{ authors: CmsAuthor[] }>(AUTHORS);
    return data.authors ?? [];
  } catch {
    return [];
  }
}

export function articlesForTagSlug(articles: CmsArticleListItem[], tagSlug: string): CmsArticleListItem[] {
  const t = tagSlug.trim().toLowerCase();
  if (!t) return [];
  return articles.filter((a) => (a.tags ?? []).some((g) => g.slug.toLowerCase() === t));
}

export function articlesForAuthorId(articles: CmsArticleListItem[], authorId: string): CmsArticleListItem[] {
  const id = authorId.trim();
  if (!id) return [];
  return articles.filter((a) => a.author?.id === id);
}
