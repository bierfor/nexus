"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AdminSessionBar } from "@/components/admin/AdminSessionBar";
import { adminGql } from "@/lib/admin-gql";
import { revalidatePublicTags } from "@/lib/admin-revalidate";
type ArticleRow = {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  coverImage: string | null;
  viewCount: number;
};

const LIST = `
  query AdminArticles {
    articles(publishedOnly: false) {
      id
      title
      slug
      published
      coverImage
      viewCount
    }
  }
`;

const PUBLISH = `mutation Publish($id: ID!) { publishArticle(id: $id) { id } }`;
const UNPUBLISH = `mutation Unpublish($id: ID!) { unpublishArticle(id: $id) { id } }`;
const DELETE = `mutation Delete($id: ID!) { deleteArticle(id: $id) }`;

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminGql<{ articles: ArticleRow[] }>(LIST);
      setArticles(data.articles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePublish(a: ArticleRow, publish: boolean) {
    setBusy(true);
    setError(null);
    try {
      await adminGql(publish ? PUBLISH : UNPUBLISH, { id: a.id });
      await revalidatePublicTags(["articles", `article-${a.slug}`]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: ArticleRow) {
    if (!confirm(`Eliminar "${a.title}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await adminGql(DELETE, { id: a.id });
      await revalidatePublicTags(["articles", `article-${a.slug}`]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al borrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <AdminSessionBar />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl text-[var(--ink)]">Articulos</h1>
        <Link href="/admin/articles/new" className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
          Nuevo articulo
        </Link>
      </div>
      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}
      {loading ? (
        <p className="loading-dots">
          <span className="loading-dot"></span>
          <span className="loading-dot"></span>
        </p>
      ) : (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex gap-4">
                {a.coverImage ? (
                  <div className="relative h-16 w-24 overflow-hidden rounded-lg bg-[var(--tag-bg)]">
                    <Image src={a.coverImage} alt="" fill className="object-cover" sizes="96px" />
                  </div>
                ) : null}
                <div>
                  <p className="font-medium text-[var(--ink)]">{a.title}</p>
                  <p className="text-xs text-[var(--muted)]">
                    /articulo/{a.slug} · {a.published ? "Publicado" : "Borrador"} · {(a.viewCount ?? 0).toLocaleString("es")} vistas
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/articles/${a.id}`} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">
                  Editar
                </Link>
                <Link href={`/articulo/${a.slug}`} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">
                  Ver
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void togglePublish(a, !a.published)}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs"
                >
                  {a.published ? "Despublicar" : "Publicar"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(a)}
                  className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-700 dark:text-red-400"
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
