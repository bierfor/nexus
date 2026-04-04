"use client";

import { useMemo, useState } from "react";
import { RevistaArticleCard } from "@/components/RevistaArticleCard";
import type { ArticleSummary } from "@/lib/types";

function tagKey(t: { slug: string }) {
  return t.slug;
}

type SortMode = "recent" | "oldest" | "read";

function safeTime(iso: string | null) {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .trim();
}

export function RevistaArchive({
  articles,
  fetchError,
}: {
  articles: ArticleSummary[];
  fetchError: string | null;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("recent");

  const allTags = useMemo(() => {
    const map = new Map<string, { name: string; slug: string }>();
    for (const a of articles) {
      for (const t of a.tags) {
        if (!map.has(t.slug)) map.set(t.slug, t);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [articles]);

  const visibleArticles = useMemo(() => {
    const q = normalize(query);

    const byTag =
      activeSlug == null
        ? articles
        : articles.filter((a) => a.tags.some((t) => t.slug === activeSlug));

    const byText =
      q.length === 0
        ? byTag
        : byTag.filter((a) => {
            const haystack = normalize(
              [a.title, a.excerpt ?? "", a.author?.name ?? "", ...a.tags.map((t) => t.name)].join(" "),
            );
            return haystack.includes(q);
          });

    const sorted = [...byText];
    sorted.sort((a, b) => {
      if (sortBy === "oldest") return safeTime(a.publishedAt) - safeTime(b.publishedAt);
      if (sortBy === "read") return (b.readTimeMinutes ?? 0) - (a.readTimeMinutes ?? 0);
      return safeTime(b.publishedAt) - safeTime(a.publishedAt);
    });
    return sorted;
  }, [activeSlug, articles, query, sortBy]);

  if (fetchError) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-8 text-sm text-[var(--body)]">
        <p className="font-medium text-[var(--ink)]">Sin conexión a la revista</p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{fetchError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <label className="sr-only" htmlFor="revista-search">
          Buscar en la revista
        </label>
        <input
          id="revista-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, extracto o etiqueta"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/15"
        />
        <label className="sr-only" htmlFor="revista-sort">
          Ordenar artículos
        </label>
        <select
          id="revista-sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortMode)}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/15"
        >
          <option value="recent">Mas recientes</option>
          <option value="oldest">Mas antiguos</option>
          <option value="read">Mas largos</option>
        </select>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Filtrar por etiqueta">
          <button
            type="button"
            onClick={() => setActiveSlug(null)}
            aria-pressed={activeSlug == null}
            className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors ${
              activeSlug == null
                ? "bg-[var(--ink)] text-[var(--cream-wash)] dark:text-[var(--bg)]"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--tag-fg)] hover:border-[var(--accent)]/30"
            }`}
          >
            Todas
          </button>
          {allTags.map((t) => (
            <button
              key={tagKey(t)}
              type="button"
              onClick={() => setActiveSlug(t.slug)}
              aria-pressed={activeSlug === t.slug}
              className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors ${
                activeSlug === t.slug
                  ? "bg-[var(--ink)] text-[var(--cream-wash)] dark:text-[var(--bg)]"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--tag-fg)] hover:border-[var(--accent)]/30"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">
        {visibleArticles.length} resultado{visibleArticles.length === 1 ? "" : "s"}
      </p>

      {visibleArticles.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {articles.length === 0
            ? "Aun no hay articulos publicados."
            : "No hay resultados con los filtros actuales. Prueba otra etiqueta o ajusta la busqueda."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5">
          {visibleArticles.map((a) => (
            <li key={a.id}>
              <RevistaArticleCard article={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
