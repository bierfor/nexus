"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const configErr = searchParams.get("config") === "jwt";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(
          json.error ??
            (res.status === 503
              ? "Servidor mal configurado (JWT). Revisa ADMIN_JWT_SECRET en backend y frontend."
              : "No se pudo iniciar sesión"),
        );
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
        Puro Flusso
      </p>
      <h1 className="font-display mt-3 text-3xl text-[var(--ink)]">Acceso administración</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        La sesión usa una cookie <strong className="font-medium text-[var(--ink)]">httpOnly</strong>{" "}
        (el navegador no expone el token a JavaScript). El secreto del API no viaja al cliente.
      </p>

      {configErr && (
        <div
          className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-[var(--ink)]"
          role="alert"
        >
          Falta <code className="rounded bg-[var(--tag-bg)] px-1">ADMIN_JWT_SECRET</code> en el
          frontend (mínimo 32 caracteres, idéntico al backend). Revisa{" "}
          <code className="rounded bg-[var(--tag-bg)] px-1">frontend/.env.local</code> y reinicia{" "}
          <code className="rounded bg-[var(--tag-bg)] px-1">npm run dev</code>.
        </div>
      )}

      {error && (
        <div
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[var(--ink)]"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Contraseña</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[var(--ink)]"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-[var(--accent)] py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <p className="mt-10 text-center text-sm text-[var(--muted)]">
        <Link href="/" className="text-[var(--accent)] hover:underline">
          Volver al sitio
        </Link>
      </p>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Cargando…</p>}>
      <LoginForm />
    </Suspense>
  );
}
