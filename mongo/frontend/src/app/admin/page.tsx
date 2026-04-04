import Link from "next/link";
import { AdminHeroPanel } from "@/components/admin/AdminHeroPanel";
import { AdminSessionBar } from "@/components/admin/AdminSessionBar";

const cards = [
  {
    title: "Articulos",
    body: "Gestiona publicaciones largas, estado y vistas.",
    href: "/admin/articles",
    cta: "Ir a articulos",
  },
  {
    title: "Crear articulo",
    body: "Formulario dedicado para escribir y publicar piezas.",
    href: "/admin/articles/new",
    cta: "Nuevo articulo",
  },
  {
    title: "Noticias relampago",
    body: "Notas breves con fuente y hack accionable.",
    href: "/admin/flash",
    cta: "Gestionar relampago",
  },
  {
    title: "API bot (IA)",
    body: "Tokens Bearer con permisos para crear flashes y articulos via GraphQL.",
    href: "/admin/bot-tokens",
    cta: "Gestionar tokens",
  },
];

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <AdminSessionBar />
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">Puro Flusso · Admin</p>
        <h1 className="font-display mt-2 text-3xl text-[var(--ink)]">Panel editorial</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Ahora cada flujo tiene su pagina: listado, creacion y gestion de relampagos.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-colors hover:border-[var(--accent)]/40"
          >
            <h2 className="font-display text-xl text-[var(--ink)]">{c.title}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{c.body}</p>
            <p className="mt-3 text-sm font-medium text-[var(--accent)]">{c.cta} →</p>
          </Link>
        ))}
      </div>

      <AdminHeroPanel />
    </div>
  );
}
