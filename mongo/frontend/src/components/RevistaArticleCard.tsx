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

const coverClass = "object-cover";

function coverAlt(article: ArticleSummary) {
  const a = article.coverImageAlt?.trim();
  return a || article.title;
}

/** Tarjeta revista con mini portada a color y etiquetas. */
export function RevistaArticleCard({ article }: { article: ArticleSummary }) {
  const date = formatDate(article.publishedAt);
  const mins = article.readTimeMinutes ?? "—";
  const tagPreview = article.tags.slice(0, 3);

  return (
    <Link
      href={`/articulo/${article.slug}`}
      className="dom-isolate group flex min-w-0 gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:shadow-md focus-visible:border-[var(--ink)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/12 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] motion-safe:active:scale-[0.998] dark:shadow-none dark:hover:shadow-[0_10px_36px_-18px_rgba(0,0,0,0.4)] dark:focus-visible:ring-offset-[var(--bg)] sm:flex-col sm:gap-3"
    >
      <div className="relative h-20 w-28 shrink-0 overflow-hidden bg-[var(--tag-bg)] sm:aspect-[16/10] sm:h-auto sm:w-full">
        {article.coverImage ? (
          <SharedArticleCover slug={article.slug}>
            <Image
              src={article.coverImage}
              alt={coverAlt(article)}
              fill
              className={coverClass}
              sizes="(max-width: 640px) 112px, (max-width: 768px) 50vw, 200px"
            />
          </SharedArticleCover>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-200/80 to-stone-300/40 dark:from-stone-800 dark:to-stone-900">
            <span className="font-display text-lg text-stone-400 opacity-60 dark:text-stone-600">PF</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-display text-base font-medium leading-snug text-[var(--ink)] group-hover:underline group-hover:underline-offset-4 sm:text-[1.05rem]">
          {article.title}
        </h3>
        <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
          {date ?? "—"} <span className="text-[var(--border)]">·</span> {mins} min
        </p>
        {tagPreview.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {tagPreview.map((t) => (
              <li
                key={t.slug}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--tag-fg)] dark:bg-[var(--tag-bg)]"
              >
                #{t.slug}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Link>
  );
}
