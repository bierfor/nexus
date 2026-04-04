"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminSessionBar } from "@/components/admin/AdminSessionBar";
import { ArticleEditorForm } from "@/components/admin/ArticleEditorForm";
import { adminGql } from "@/lib/admin-gql";

const ARTICLE_ADMIN = `
  query ArticleAdmin($id: ID!) {
    articleAdmin(id: $id) {
      id
      title
      slug
      excerpt
      content
      coverImage
      coverImageAlt
      readTimeMinutes
      published
      tags { slug }
    }
  }
`;

type ArticleAdmin = {
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content: string;
    coverImage: string | null;
    coverImageAlt: string | null;
    readTimeMinutes: number | null;
    published: boolean;
    tags: { slug: string }[];
  };

export default function AdminEditArticlePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const [article, setArticle] = useState<ArticleAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const data = await adminGql<{ articleAdmin: ArticleAdmin | null }>(ARTICLE_ADMIN, { id });
        setArticle(data.articleAdmin);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cargar");
      }
    })();
  }, [id]);

  return (
    <div className="space-y-8">
      <AdminSessionBar />
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">Edicion</p>
        <h1 className="font-display mt-2 text-3xl text-[var(--ink)]">Editar articulo</h1>
      </div>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {!article ? (
          <p className="text-sm text-[var(--muted)]">Cargando articulo...</p>
        ) : (
          <ArticleEditorForm
            mode="edit"
            articleId={article.id}
            initial={{
              title: article.title,
              slug: article.slug,
              excerpt: article.excerpt ?? "",
              content: article.content,
              coverUrl: article.coverImage ?? "",
              coverImageAlt: article.coverImageAlt ?? "",
              readTime: article.readTimeMinutes != null ? String(article.readTimeMinutes) : "",
              tagSlugs: article.tags.map((t) => t.slug).join(", "),
              published: article.published,
            }}
          />
        )}
      </section>
    </div>
  );
}
