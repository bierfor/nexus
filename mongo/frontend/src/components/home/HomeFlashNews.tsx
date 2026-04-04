import Link from "next/link";
import type { FlashNewsSummary } from "@/lib/types";

function shortExcerpt(text: string, max = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function flashCategory(title: string) {
  const t = title.toLowerCase();
  if (t.includes("bio") || t.includes("microplastic")) return { label: "Bio-Hack", cls: "text-emerald-700 bg-emerald-100 border-emerald-200" };
  if (t.includes("dorm") || t.includes("sueno")) return { label: "Sueno", cls: "text-indigo-700 bg-indigo-100 border-indigo-200" };
  if (t.includes("foco") || t.includes("niebla") || t.includes("cogn")) return { label: "Foco", cls: "text-amber-800 bg-amber-100 border-amber-200" };
  return { label: "Mindset", cls: "text-stone-700 bg-stone-100 border-stone-200" };
}

export function HomeFlashNews({ items }: { items: FlashNewsSummary[] }) {
  const ranked = [...items]
    .sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0))
    .slice(0, 4);

  if (ranked.length === 0) return null;

  return (
    <section
      aria-label="Noticias relampago"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/75 p-4 sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          Relampago · 60 segundos
        </p>
        <span className="rounded-full border border-[var(--accent)]/25 px-2.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
          FAST READ
        </span>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {ranked.map((a, index) => {
          const date = formatDate(a.publishedAt);
          const hack = a.hack?.trim() || "Reduce friccion digital en una accion concreta hoy.";
          const cat = flashCategory(a.title);
          return (
            <li key={a.id} className={index === 3 ? "hidden sm:block" : ""}>
              <Link
                href={a.sourceUrl?.trim() ? a.sourceUrl : `/articulo/${a.slug}`}
                rel={a.sourceUrl?.trim() ? "noopener noreferrer" : undefined}
                className="group block rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5 transition-colors hover:border-[var(--accent)]/40"
              >
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                  {date ?? "Ahora"} {a.sourceLabel ? <><span aria-hidden>·</span> {a.sourceLabel}</> : null}
                </p>
                <p className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${cat.cls}`}>
                  {cat.label}
                </p>
                <h3 className="mt-1.5 text-base font-semibold leading-snug text-[var(--ink)] group-hover:text-[var(--accent)]">
                  {a.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--body)]">{shortExcerpt(a.summary, 125)}</p>
                <p className="mt-2.5 text-xs font-medium text-[var(--muted)]">
                  <span className="text-[var(--accent)]">Hack:</span> {hack}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
