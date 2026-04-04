import Image from "next/image";
import Link from "next/link";
import { SharedArticleCover } from "@/components/SharedArticleCover";
import type { ArticleSummary } from "@/lib/types";

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function ArticleCard({
  article,
  variant = "default",
}: {
  article: ArticleSummary;
  variant?: "default" | "editorial";
}) {
  const date = formatDate(article.publishedAt);
  const isEd = variant === "editorial";

  return (
    <article
      className={
        isEd
          ? "group relative border-b border-[var(--border)] bg-transparent py-10 first:pt-2 transition-colors hover:border-[var(--accent)]/30"
          : "group relative rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm transition hover:border-[var(--accent)]/40 hover:shadow-md"
      }
    >
      {article.coverImage && (
        <div
          className={
            isEd
              ? "relative mb-6 aspect-[2/1] w-full overflow-hidden rounded-lg bg-[var(--tag-bg)]"
              : "relative mb-4 aspect-[21/9] w-full overflow-hidden rounded-lg bg-[var(--tag-bg)]"
          }
        >
          <SharedArticleCover slug={article.slug}>
            <Image
              src={article.coverImage}
              alt={article.coverImageAlt?.trim() || article.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 42rem"
            />
          </SharedArticleCover>
        </div>
      )}
      {!isEd && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          {date && <time dateTime={article.publishedAt ?? undefined}>{date}</time>}
          {article.readTimeMinutes != null && (
            <>
              <span aria-hidden>·</span>
              <span>{article.readTimeMinutes} min</span>
            </>
          )}
          {article.author && (
            <>
              <span aria-hidden>·</span>
              <span>{article.author.name}</span>
            </>
          )}
        </div>
      )}
      {isEd && (
        <div className="mb-3 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
          {article.readTimeMinutes != null && <span>{article.readTimeMinutes} min</span>}
          {date && <time dateTime={article.publishedAt ?? undefined}>{date}</time>}
        </div>
      )}
      <h2
        className={
          isEd
            ? "font-display text-2xl leading-tight text-[var(--ink)] sm:text-3xl group-hover:text-[var(--accent)]"
            : "font-display text-2xl leading-snug text-[var(--ink)] group-hover:text-[var(--accent)]"
        }
      >
        <Link
          href={`/articulo/${article.slug}`}
          className={isEd ? "after:absolute after:inset-0" : "after:absolute after:inset-0 after:rounded-xl"}
        >
          <span className="relative">{article.title}</span>
        </Link>
      </h2>
      {article.excerpt && (
        <p
          className={
            isEd
              ? "relative mt-4 max-w-2xl text-base leading-relaxed text-[var(--body)]"
              : "relative mt-3 text-sm leading-relaxed text-[var(--muted)]"
          }
        >
          {article.excerpt}
        </p>
      )}
      {!isEd && article.tags.length > 0 && (
        <ul className="relative mt-4 flex flex-wrap gap-2">
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
    </article>
  );
}
