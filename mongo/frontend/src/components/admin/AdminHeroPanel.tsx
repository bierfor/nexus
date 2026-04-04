"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminGql, uploadCoverImage } from "@/lib/admin-gql";
import { revalidatePublicTags } from "@/lib/admin-revalidate";

function isAllowedHeroImageUrl(u: string): boolean {
  const t = u.trim();
  if (!t) return true;
  if (t.startsWith("/")) return true;
  try {
    const p = new URL(t);
    if (p.protocol === "https:") return true;
    if (
      p.protocol === "http:" &&
      (p.hostname === "localhost" || p.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const HEROES_ADMIN = `
  query HeroesAdmin {
    heroesAdmin {
      slug
      headline
      published
      updatedAt
    }
  }
`;

const HERO_ADMIN = `
  query HeroAdmin($slug: String!) {
    heroAdmin(slug: $slug) {
      slug
      kicker
      headline
      subheadline
      body
      bodySecondary
      imageUrl
      footerCtaLabel
      footerCtaHref
      published
      updatedAt
    }
  }
`;

const UPSERT = `
  mutation UpsertHero($input: HeroUpsertInput!) {
    upsertHero(input: $input) {
      slug
      updatedAt
    }
  }
`;

type HeroRow = { slug: string; headline: string; published: boolean; updatedAt: string };
type HeroFull = {
  slug: string;
  kicker: string | null;
  headline: string;
  subheadline: string | null;
  body: string;
  bodySecondary: string | null;
  imageUrl: string | null;
  footerCtaLabel: string | null;
  footerCtaHref: string | null;
  published: boolean;
  updatedAt: string;
};

const emptyForm = {
  slug: "home",
  kicker: "",
  headline: "",
  subheadline: "",
  body: "",
  bodySecondary: "",
  imageUrl: "",
  footerCtaLabel: "Ver la revista",
  footerCtaHref: "/#revista",
  published: true,
};

export function AdminHeroPanel() {
  const [list, setList] = useState<HeroRow[]>([]);
  const [selectMode, setSelectMode] = useState<string>("home");
  const [form, setForm] = useState(emptyForm);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHero, setLoadingHero] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const heroImageInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setErr(null);
    try {
      const data = await adminGql<{ heroesAdmin: HeroRow[] }>(HEROES_ADMIN);
      setList(data.heroesAdmin);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al listar heroes");
      setList([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadHero = useCallback(async (slug: string) => {
    if (!slug.trim()) return;
    setLoadingHero(true);
    setErr(null);
    try {
      const data = await adminGql<{ heroAdmin: HeroFull | null }>(HERO_ADMIN, { slug: slug.trim() });
      const h = data.heroAdmin;
      if (h) {
        setForm({
          slug: h.slug,
          kicker: h.kicker ?? "",
          headline: h.headline,
          subheadline: h.subheadline ?? "",
          body: h.body,
          bodySecondary: h.bodySecondary ?? "",
          imageUrl: h.imageUrl ?? "",
          footerCtaLabel: h.footerCtaLabel ?? "",
          footerCtaHref: h.footerCtaHref ?? "",
          published: h.published,
        });
      } else {
        setForm({ ...emptyForm, slug: slug.trim() });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar hero");
    } finally {
      setLoadingHero(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectMode === "__new__") {
      setForm({ ...emptyForm, slug: "" });
      return;
    }
    void loadHero(selectMode);
  }, [selectMode, loadHero]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    if (!isAllowedHeroImageUrl(form.imageUrl)) {
      setErr("La URL de imagen debe ser https, una ruta que empiece por /, o http solo en localhost.");
      setSaving(false);
      return;
    }
    try {
      await adminGql(UPSERT, {
        input: {
          slug: form.slug.trim(),
          kicker: form.kicker.trim() || null,
          headline: form.headline.trim(),
          subheadline: form.subheadline.trim() || null,
          body: form.body.trim(),
          bodySecondary: form.bodySecondary.trim() || null,
          imageUrl: form.imageUrl.trim() || null,
          footerCtaLabel: form.footerCtaLabel.trim() || null,
          footerCtaHref: form.footerCtaHref.trim() || null,
          published: form.published,
        },
      });
      await revalidatePublicTags(["heroes"]);
      setMsg("Hero guardado.");
      await loadList();
      setSelectMode(form.slug.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function onHeroImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setErr("El archivo debe ser una imagen.");
      return;
    }
    setErr(null);
    setUploadingImage(true);
    try {
      const { url } = await uploadCoverImage(file);
      setForm((f) => ({ ...f, imageUrl: url }));
      setMsg("Imagen subida a Cloudinary. Pulsa «Guardar hero» para guardarla en la base de datos.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al subir imagen");
    } finally {
      setUploadingImage(false);
    }
  }

  function onHeroImageDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) void onHeroImage(f);
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 dark:bg-[var(--surface)]">
      <h2 className="font-display text-xl text-[var(--ink)]">Hero de portada y bloques</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Cada <strong className="font-medium text-[var(--ink)]">slug</strong> es un bloque distinto (la pública usa{" "}
        <code className="rounded bg-[var(--tag-bg)] px-1">home</code>). Negritas en textos:{" "}
        <code className="rounded bg-[var(--tag-bg)] px-1">**así**</code>. Párrafos nuevos: línea en blanco.
      </p>

      {err && (
        <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--body)]" role="alert">
          {err}
        </p>
      )}
      {msg && <p className="mt-4 text-sm text-[var(--muted)]">{msg}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-[var(--muted)]">
          Bloque
          <select
            value={selectMode}
            disabled={loadingList}
            onChange={(e) => {
              setSelectMode(e.target.value);
              setMsg(null);
            }}
            className="ml-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[var(--ink)]"
          >
            <option value="home">home</option>
            {list
              .filter((h) => h.slug !== "home")
              .map((h) => (
                <option key={h.slug} value={h.slug}>
                  {h.slug} {h.published ? "" : "(borrador)"}
                </option>
              ))}
            <option value="__new__">+ Nuevo slug…</option>
          </select>
        </label>
        {loadingList && <span className="text-xs text-[var(--muted)]">Cargando lista…</span>}
        {loadingHero && <span className="text-xs text-[var(--muted)]">Cargando bloque…</span>}
      </div>

      <form onSubmit={onSave} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Slug (identificador URL interno)</span>
          <input
            required
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="home"
            className="mt-1 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--ink)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Línea superior (kicker)</span>
          <input
            value={form.kicker}
            onChange={(e) => setForm((f) => ({ ...f, kicker: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Titular (H1)</span>
          <input
            required
            value={form.headline}
            onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Subtítulo bajo el H1 (opcional)</span>
          <input
            value={form.subheadline}
            onChange={(e) => setForm((f) => ({ ...f, subheadline: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Cuerpo principal</span>
          <textarea
            required
            rows={4}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Segundo texto (opcional)</span>
          <textarea
            rows={3}
            value={form.bodySecondary}
            onChange={(e) => setForm((f) => ({ ...f, bodySecondary: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <div
          className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/50 p-4 dark:bg-[var(--card)]/40"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={onHeroImageDrop}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">Imagen del hero</p>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--muted)]">
                Sube un archivo (Cloudinary, carpeta <code className="rounded bg-[var(--tag-bg)] px-1">puro-flusso/covers</code>
                ). También puedes pegar una URL abajo si la imagen ya está alojada.
              </p>
            </div>
            <input
              ref={heroImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onHeroImage(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={uploadingImage || saving}
              onClick={() => heroImageInputRef.current?.click()}
              className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]/20 hover:bg-[var(--surface)] disabled:opacity-50 dark:bg-[var(--surface)]"
            >
              {uploadingImage ? "Subiendo…" : "Elegir imagen…"}
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-[var(--muted)]">
            O arrastra una imagen aquí
          </p>

          {form.imageUrl.trim() ? (
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div className="relative h-44 w-36 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--tag-bg)] shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL remota dinámica (Cloudinary / cualquiera) */}
                <img
                  src={form.imageUrl.trim()}
                  alt="Vista previa del hero"
                  className="h-full w-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, imageUrl: "" }));
                  setMsg(null);
                }}
                className="text-xs font-medium text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
              >
                Quitar imagen (solo del formulario)
              </button>
            </div>
          ) : null}

          <label className="mt-4 block text-sm">
            <span className="text-[var(--muted)]">URL de imagen (editable)</span>
            <input
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              placeholder="https://res.cloudinary.com/… o pega tras subir"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--ink)]"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Texto del enlace inferior</span>
            <input
              value={form.footerCtaLabel}
              onChange={(e) => setForm((f) => ({ ...f, footerCtaLabel: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)]"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Href del enlace</span>
            <input
              value={form.footerCtaHref}
              onChange={(e) => setForm((f) => ({ ...f, footerCtaHref: e.target.value }))}
              className="mt-1 w-full min-w-[12rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--ink)]"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--body)]">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))}
            className="rounded border-[var(--border)] accent-[var(--ink)]"
          />
          Publicado (visible en la web)
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-[var(--ink)] px-6 py-2.5 text-sm font-medium text-[var(--cream-wash)] disabled:opacity-50 dark:text-[var(--bg)]"
        >
          {saving ? "Guardando…" : "Guardar hero"}
        </button>
      </form>
    </section>
  );
}
