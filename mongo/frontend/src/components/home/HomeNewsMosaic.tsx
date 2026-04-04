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

function coverAlt(article: ArticleSummary) {
  const a = article.coverImageAlt?.trim();
  return a || article.title;
}

function tileClass(index: number) {
  if (index === 0) return "sm:col-span-2 lg:col-span-4 lg:row-span-2 min-h-[24rem]";
  if (index === 1) return "sm:col-span-1 lg:col-span-2 lg:row-span-2 min-h-[24rem]";
  if (index === 2) return "sm:col-span-1 lg:col-span-3 lg:row-span-1 min-h-[14rem]";
  return "sm:col-span-1 lg:col-span-3 lg:row-span-1 min-h-[13rem]";
}

export function HomeNewsMosaic({ articles }: { articles: ArticleSummary[] }) {
  const ranked = [...articles]
    .sort((a, b) => {
      const ad = Date.parse(a.publishedAt ?? "") || 0;
      const bd = Date.parse(b.publishedAt ?? "") || 0;
      if (bd !== ad) return bd - ad;
      return (b.viewCount ?? 0) - (a.viewCount ?? 0);
    })
    .slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="grid auto-rows-auto grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {ranked.map((article, i) => {
        const date = formatDate(article.publishedAt);
        const mins = article.readTimeMinutes ?? "—";
        const tags = article.tags.slice(0, 2);
        return (
          <Link
            key={article.id}
            href={`/articulo/${article.slug}`}
            className={`dom-isolate group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] ${tileClass(i)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/12 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]`}
          >
            {article.coverImage ? (
              <SharedArticleCover slug={article.slug}>
                <Image
                  src={article.coverImage}
                  alt={coverAlt(article)}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
              </SharedArticleCover>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--tag-bg)] to-[var(--surface)]" aria-hidden />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/5" aria-hidden />

            <div className="absolute inset-x-0 bottom-0 z-[1] p-4 sm:p-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/80">
                {date ?? "—"} <span className="text-white/40">·</span> {mins} min
              </p>
              <h3
                className={`mt-2 font-display leading-tight text-white ${i < 2 ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"}`}
              >
                {article.title}
              </h3>
              {i < 2 && article.excerpt && (
                <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-white/85">
                  {article.excerpt}
                </p>
              )}
              {tags.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <li
                      key={t.slug}
                      className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/90 backdrop-blur-[2px]"
                    >
                      #{t.slug}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Link>
        );
        })}
      </div>
      <div className="flex justify-end">
        <Link
          href="/revista"
          className="rounded-sm text-sm font-medium text-[var(--accent)] transition-colors hover:text-[var(--ink)] hover:underline"
        >
          Ver archivo completo →
        </Link>
      </div>
    </div>
  );
}
