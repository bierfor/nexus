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

type EmptyVariant = "error" | "soon";

function coverAlt(article: ArticleSummary) {
  const a = article.coverImageAlt?.trim();
  return a || article.title;
}

/** Destacado: tipografía + portada a color. */
export function RevistaFeaturedCard({
  article,
  emptyVariant = "soon",
}: {
  article: ArticleSummary | null;
  emptyVariant?: EmptyVariant;
}) {
  if (!article) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-8 py-12 text-center shadow-sm dark:shadow-none">
        {emptyVariant === "error" ? (
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            La revista vuelve en cuanto el backend esté en marcha.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Aún no hay piezas publicadas. Mientras tanto puedes revisar el archivo o el boletín.
            </p>
            <Link
              href="/revista"
              className="inline-flex text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
            >
              Ir al archivo de la revista
            </Link>
          </div>
        )}
      </div>
    );
  }

  const date = formatDate(article.publishedAt);
  const mins = article.readTimeMinutes ?? "—";
  const tags = article.tags.slice(0, 5);

  return (
    <Link
      href={`/articulo/${article.slug}`}
      className="dom-isolate group block min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-[var(--border)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/12 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] motion-safe:active:scale-[0.998] dark:bg-[var(--card)] dark:shadow-none dark:hover:shadow-[0_12px_40px_-20px_rgba(0,0,0,0.45)] dark:focus-visible:ring-offset-[var(--bg)] md:flex md:min-h-[min(22rem,52vw)]"
    >
      {article.coverImage ? (
        <div className="relative aspect-[16/10] w-full shrink-0 md:aspect-auto md:w-[44%] md:max-w-md">
          <SharedArticleCover slug={article.slug}>
            <Image
              src={article.coverImage}
              alt={coverAlt(article)}
              fill
              className={coverClass}
              sizes="(max-width: 768px) 100vw, 320px"
            />
          </SharedArticleCover>
        </div>
      ) : null}
      <div
        className={`flex flex-col justify-center px-8 py-12 md:flex-1 md:px-12 md:py-14 ${article.coverImage ? "" : "md:px-14 md:py-16"}`}
      >
        <h3 className="break-words font-display text-2xl font-medium leading-snug text-[var(--ink)] md:text-[1.65rem] md:leading-tight">
          {article.title}
        </h3>
        {article.excerpt ? (
          <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-[var(--body)]">{article.excerpt}</p>
        ) : null}
        <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
          {date ?? "—"} <span className="text-[var(--border)]">·</span> {mins} min de lectura
        </p>
        {tags.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {tags.map((t) => (
              <li
                key={t.slug}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--tag-fg)] dark:bg-[var(--tag-bg)]"
              >
                #{t.slug}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm font-medium text-[var(--muted)] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          Leer artículo →
        </p>
      </div>
    </Link>
  );
}
