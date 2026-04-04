"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const links = [
  { href: "/admin", label: "Panel" },
  { href: "/admin/articles", label: "Articulos" },
  { href: "/admin/articles/new", label: "Crear articulo" },
  { href: "/admin/flash", label: "Noticias relampago" },
  { href: "/admin/bot-tokens", label: "API bot" },
];

export function AdminSessionBar() {
  const { user, loading, logout } = useAdminAuth();
  const pathname = usePathname();

  return (
    <div className="space-y-4 border-b border-[var(--border)] pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">
          {loading ? "Cargando sesion..." : user ? `Conectado como ${user.email}` : "Sesion no iniciada"}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-sm font-medium text-[var(--accent)] hover:underline"
        >
          Cerrar sesion
        </button>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Navegacion admin">
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${
                active
                  ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--body)] hover:border-[var(--accent)]/35"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
