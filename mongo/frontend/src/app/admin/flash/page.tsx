"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSessionBar } from "@/components/admin/AdminSessionBar";
import { adminGql } from "@/lib/admin-gql";
import { revalidatePublicTags } from "@/lib/admin-revalidate";

type FlashRow = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  hack: string | null;
  published: boolean;
  publishedAt: string | null;
};

const LIST = `query FlashAdmin { flashNews(publishedOnly: false, limit: 30) { id title slug summary sourceLabel sourceUrl hack published publishedAt } }`;
const CREATE = `mutation Create($input: FlashNewsInput!) { createFlashNews(input: $input) { id } }`;
const UPDATE = `mutation Update($id: ID!, $input: FlashNewsUpdateInput!) { updateFlashNews(id: $id, input: $input) { id } }`;
const PUB = `mutation Pub($id: ID!) { publishFlashNews(id: $id) { id } }`;
const UNPUB = `mutation Unpub($id: ID!) { unpublishFlashNews(id: $id) { id } }`;
const DEL = `mutation Del($id: ID!) { deleteFlashNews(id: $id) }`;

function slugify(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function AdminFlashPage() {
  const [rows, setRows] = useState<FlashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [hack, setHack] = useState("");
  const [published, setPublished] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminGql<{ flashNews: FlashRow[] }>(LIST);
      setRows(data.flashNews);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setTitle("");
    setSlug("");
    setSummary("");
    setSourceLabel("");
    setSourceUrl("");
    setHack("");
    setPublished(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cleanSlug = slug.trim() || slugify(title);
      const input = {
        title,
        slug: cleanSlug,
        summary,
        sourceLabel: sourceLabel.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        hack: hack.trim() || null,
        published,
      };
      if (editing) await adminGql(UPDATE, { id: editing, input });
      else await adminGql(CREATE, { input });
      await revalidatePublicTags(["flash-news"]);
      resetForm();
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: FlashRow) {
    setEditing(r.id);
    setTitle(r.title);
    setSlug(r.slug);
    setSummary(r.summary);
    setSourceLabel(r.sourceLabel ?? "");
    setSourceUrl(r.sourceUrl ?? "");
    setHack(r.hack ?? "");
    setPublished(r.published);
  }

  async function togglePublish(r: FlashRow, next: boolean) {
    setBusy(true);
    try {
      await adminGql(next ? PUB : UNPUB, { id: r.id });
      await revalidatePublicTags(["flash-news"]);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: FlashRow) {
    if (!confirm(`Eliminar "${r.title}"?`)) return;
    setBusy(true);
    try {
      await adminGql(DEL, { id: r.id });
      await revalidatePublicTags(["flash-news"]);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <AdminSessionBar />
      <h1 className="font-display text-3xl text-[var(--ink)]">Noticias relampago</h1>
      {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">{error}</p> : null}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="font-display text-xl text-[var(--ink)]">{editing ? "Editar flash" : "Crear flash"}</h2>
        <form onSubmit={save} className="mt-4 space-y-3">
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titulo" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={title ? slugify(title) : "slug"} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <textarea required value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Resumen breve" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Fuente (label)" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://fuente.com/..." className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input value={hack} onChange={(e) => setHack(e.target.value)} placeholder="Hack accionable" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Publicada
          </label>
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
              {editing ? "Guardar" : "Crear"}
            </button>
            {editing ? (
              <button type="button" onClick={resetForm} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm">
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="space-y-3">
        {loading ? <p className="text-sm text-[var(--muted)]">Cargando...</p> : null}
        {rows.map((r) => (
          <article key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted)]">{r.published ? "Publicada" : "Borrador"} · {r.slug}</p>
            <h3 className="mt-1 font-medium text-[var(--ink)]">{r.title}</h3>
            <p className="mt-1 text-sm text-[var(--body)]">{r.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => startEdit(r)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">Editar</button>
              <button type="button" disabled={busy} onClick={() => void togglePublish(r, !r.published)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">
                {r.published ? "Despublicar" : "Publicar"}
              </button>
              <button type="button" disabled={busy} onClick={() => void remove(r)} className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-700 dark:text-red-400">
                Eliminar
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
