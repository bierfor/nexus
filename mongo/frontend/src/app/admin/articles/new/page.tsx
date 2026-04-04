import { AdminSessionBar } from "@/components/admin/AdminSessionBar";
import { ArticleEditorForm } from "@/components/admin/ArticleEditorForm";

export default function AdminNewArticlePage() {
  return (
    <div className="space-y-8">
      <AdminSessionBar />
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">Creacion</p>
        <h1 className="font-display mt-2 text-3xl text-[var(--ink)]">Nuevo articulo</h1>
      </div>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <ArticleEditorForm mode="create" />
      </section>
    </div>
  );
}
