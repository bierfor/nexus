import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/ArticleBody";
import { SharedArticleCover } from "@/components/SharedArticleCover";
import { ArticleReadingProgress } from "@/components/ArticleReadingProgress";
import { ArticleShare } from "@/components/ArticleShare";
import { ArticleViewCounter } from "@/components/ArticleViewCounter";
import { gql } from "@/lib/graphql";
import { ARTICLE_BY_SLUG_QUERY } from "@/lib/queries";
import type { ArticleDetail } from "@/lib/types";
import { absoluteUrl } from "@/lib/absolute-url";
import { buildArticlePageJsonLd } from "@/lib/json-ld";
import { siteUrl } from "@/lib/site-url";
import type { Metadata } from "next";
import { cache } from "react";

type ArticleData = { article: ArticleDetail | null };

type Props = { params: Promise<{ slug: string }> };

const getArticleBySlug = cache(async (slug: string) => {
  return gql<ArticleData>(ARTICLE_BY_SLUG_QUERY, { slug }, {
    revalidate: 120,
    tags: ["articles", `article-${slug}`],
  });
});

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const base = siteUrl().replace(/\/$/, "");
  try {
    const data = await getArticleBySlug(slug);
    if (!data.article) return { title: "No encontrado" };
    const a = data.article;
    const canonicalPath = `/articulo/${encodeURIComponent(a.slug)}`;
    const ogImage = a.coverImage ? absoluteUrl(base, a.coverImage) : undefined;
    const published = a.publishedAt ?? undefined;
    const modified = a.updatedAt || published;
    return {
      title: a.title,
      description: a.excerpt ?? undefined,
      alternates: { canonical: canonicalPath },
      openGraph: {
        type: "article",
        locale: "es_ES",
        url: absoluteUrl(base, canonicalPath),
        title: a.title,
        description: a.excerpt ?? undefined,
        publishedTime: published,
        modifiedTime: modified,
        authors: a.author?.name ? [a.author.name] : undefined,
        tags: a.tags.length > 0 ? a.tags.map((t) => t.name) : undefined,
        images: ogImage
          ? [{ url: ogImage, alt: a.coverImageAlt?.trim() || a.title }]
          : undefined,
      },
      twitter: {
        card: ogImage ? "summary_large_image" : "summary",
        title: a.title,
        description: a.excerpt ?? undefined,
        images: ogImage ? [ogImage] : undefined,
      },
      robots: { index: true, follow: true },
    };
  } catch {
    return { title: "Artículo" };
  }
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export default async function ArticuloPage(props: Props) {
  const { slug } = await props.params;
  let article: ArticleDetail | null = null;

  try {
    const data = await getArticleBySlug(slug);
    article = data.article;
  } catch {
    notFound();
  }

  if (!article) notFound();

  const date = formatDate(article.publishedAt);
  const base = siteUrl().replace(/\/$/, "");
  const articleJsonLd = buildArticlePageJsonLd(base, article);

  const shareUrl = absoluteUrl(base, `/articulo/${encodeURIComponent(article.slug)}`);

  return (
    <article
      className="mx-auto min-w-0 w-full max-w-3xl"
      aria-labelledby="article-title"
    >
      <ArticleReadingProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <Link
        href="/"
        className="rounded-sm text-sm font-medium text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]/35"
      >
        ← Índice
      </Link>

      <header className="mt-6">
        {article.coverImage && (
          <div className="relative mb-8 aspect-[2/1] w-full overflow-hidden rounded-xl bg-[var(--tag-bg)]">
            <SharedArticleCover slug={article.slug}>
              <Image
                src={article.coverImage}
                alt={article.coverImageAlt?.trim() || article.title}
                priority
                fill
                className="object-cover [filter:none] [-webkit-filter:none] [forced-color-adjust:none]"
                sizes="(max-width: 768px) 100vw, 42rem"
              />
            </SharedArticleCover>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          {date && <time dateTime={article.publishedAt ?? undefined}>{date}</time>}
          {article.readTimeMinutes != null && (
            <>
              <span aria-hidden>·</span>
              <span>{article.readTimeMinutes} min de lectura</span>
            </>
          )}
          <>
            <span aria-hidden>·</span>
            <ArticleViewCounter
              key={article.slug}
              slug={article.slug}
              initialCount={article.viewCount ?? 0}
            />
          </>
        </div>
        <h1
          id="article-title"
          className="font-display mt-4 text-4xl font-medium tracking-tight text-[var(--ink)] sm:text-5xl"
        >
          {article.title}
        </h1>
        {article.excerpt && (
          <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">{article.excerpt}</p>
        )}
        {article.author && (
          <p className="mt-6 text-sm text-[var(--body)]">
            <span className="text-[var(--muted)]">Por </span>
            <span className="font-medium text-[var(--ink)]">{article.author.name}</span>
            {article.author.bio && (
              <span className="block mt-1 text-[var(--muted)]">{article.author.bio}</span>
            )}
          </p>
        )}
        {article.tags.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((t) => (
              <li
                key={t.slug}
                className="rounded-full bg-[var(--tag-bg)] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--tag-fg)]"
              >
                {t.name}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-8">
          <ArticleShare title={article.title} url={shareUrl} />
        </div>
      </header>

      <div className="prose-wrap render-optimized mt-12 border-t border-[var(--border)] pt-10">
        <ArticleBody content={article.content} />
      </div>
    </article>
  );
}
