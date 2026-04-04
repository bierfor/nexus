"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adminGql, uploadCoverImage } from "@/lib/admin-gql";
import { revalidatePublicTags } from "@/lib/admin-revalidate";

type Props = {
  mode: "create" | "edit";
  articleId?: string;
  initial?: {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    coverUrl: string;
    coverImageAlt: string;
    readTime: string;
    tagSlugs: string;
    published: boolean;
  };
};

const CREATE = `mutation Create($input: ArticleInput!) { createArticle(input: $input) { id slug } }`;
const UPDATE = `mutation Update($id: ID!, $input: ArticleUpdateInput!) { updateArticle(id: $id, input: $input) { id slug } }`;

function slugify(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function ArticleEditorForm({ mode, articleId, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl ?? "");
  const [coverImageAlt, setCoverImageAlt] = useState(initial?.coverImageAlt ?? "");
  const [readTime, setReadTime] = useState(initial?.readTime ?? "");
  const [tagSlugs, setTagSlugs] = useState(initial?.tagSlugs ?? "productividad");
  const [publishNow, setPublishNow] = useState(initial?.published ?? false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function onCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Subiendo portada...");
    try {
      const { url } = await uploadCoverImage(file);
      setCoverUrl(url);
      setStatus("Portada lista.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de subida");
      setStatus(null);
    }
  }

  async function onBodyImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Subiendo imagen para el cuerpo...");
    try {
      const { url } = await uploadCoverImage(file);
      const label = file.name.replace(/\.[^.]+$/i, "") || "imagen";
      const snippet = `\n\n![${label}](${url})\n\n`;
      const el = textareaRef.current;
      if (!el) setContent((prev) => `${prev}${snippet}`);
      else {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        setContent((prev) => prev.slice(0, start) + snippet + prev.slice(end));
      }
      setStatus("Imagen insertada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de subida");
      setStatus(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cleanSlug = slug.trim() || slugify(title);
      const slugs = tagSlugs.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      const rt = readTime.trim() ? Number(readTime) : null;
      const input = {
        title,
        slug: cleanSlug,
        excerpt: excerpt.trim() || null,
        content,
        coverImage: coverUrl.trim() || null,
        coverImageAlt: coverImageAlt.trim() || null,
        readTimeMinutes: Number.isFinite(rt as number) ? rt : null,
        tagSlugs: slugs,
        published: publishNow,
      };
      if (mode === "create") await adminGql(CREATE, { input });
      else await adminGql(UPDATE, { id: articleId, input });
      await revalidatePublicTags(["articles", `article-${cleanSlug}`]);
      router.push("/admin/articles");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">{error}</p> : null}
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Titulo</span>
        <input required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Slug</span>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={title ? slugify(title) : ""} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Resumen</span>
        <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
      </label>
      <div className="block text-sm">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[var(--muted)]">Cuerpo (Markdown)</span>
          <label className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs">
            Imagen aqui
            <input type="file" accept="image/*" className="hidden" onChange={onBodyImageUpload} />
          </label>
        </div>
        <textarea ref={textareaRef} required rows={14} value={content} onChange={(e) => setContent(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm" />
      </div>
      <div className="rounded-lg border border-dashed border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--ink)]">Portada</p>
        <input type="file" accept="image/*" onChange={onCoverUpload} className="mt-2 text-sm" />
        {status ? <p className="mt-2 text-xs text-[var(--muted)]">{status}</p> : null}
        <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="URL portada" className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
        <input value={coverImageAlt} onChange={(e) => setCoverImageAlt(e.target.value)} placeholder="Texto alternativo" className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
      </div>
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Etiquetas (slugs)</span>
        <input value={tagSlugs} onChange={(e) => setTagSlugs(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Minutos de lectura</span>
        <input type="number" min={1} value={readTime} onChange={(e) => setReadTime(e.target.value)} className="mt-1 w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
      </label>
      <label className="flex items-center gap-2 text-sm text-[var(--body)]">
        <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
        Publicado
      </label>
      <button type="submit" disabled={busy} className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {mode === "create" ? "Crear articulo" : "Guardar cambios"}
      </button>
    </form>
  );
}
