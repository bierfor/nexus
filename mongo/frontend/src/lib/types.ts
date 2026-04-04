export type Tag = {
  name: string;
  slug: string;
};

export type ArticleSummary = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  readTimeMinutes: number | null;
  viewCount: number;
  publishedAt: string | null;
  coverImage: string | null;
  coverImageAlt: string | null;
  author: { name: string } | null;
  tags: Tag[];
};

export type ArticleDetail = ArticleSummary & {
  content: string;
  author: { name: string; bio: string | null } | null;
  updatedAt: string;
};

export type FlashNewsSummary = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  hack: string | null;
  publishedAt: string | null;
};

/** Contenido del hero de portada (GraphQL `hero` o valores por defecto). */
export type HomeHeroContent = {
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
