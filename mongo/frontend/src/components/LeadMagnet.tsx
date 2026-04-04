"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

type Variant = "hero" | "card";

const OPTIONAL_TOPICS = [
  { slug: "productividad", label: "Productividad y foco" },
  { slug: "minimalismo", label: "Minimalismo digital" },
  { slug: "economia-real", label: "Economía real" },
] as const;

/** Mismo resultado en Node y navegador (evita diferencias de Intl en hidratación). */
function formatLeadCountEs(n: number): string {
  const s = String(Math.trunc(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function socialProofHeroLine(): string {
  const raw = process.env.NEXT_PUBLIC_SOCIAL_PROOF_LEADS;
  const parsed = raw != null && raw !== "" ? Number.parseInt(raw, 10) : 1200;
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
  return `Únete a +${formatLeadCountEs(safe)} personas. No spam.`;
}

export function LeadMagnet({ variant = "card" }: { variant?: Variant }) {
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [topicPick, setTopicPick] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const topicsGroupLabelId = useId();

  const proofHeroText = useMemo(() => socialProofHeroLine(), []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted) {
      setMessage("Marca la casilla de consentimiento para continuar.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setMessage(null);
    try {
      const interests = OPTIONAL_TOPICS.filter((t) => topicPick[t.slug]).map((t) => t.slug);
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "puro-flusso-boletin",
          ...(interests.length > 0 ? { interests } : {}),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "No se pudo registrar");
      }
      setStatus("success");
      setMessage(null);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Error");
    }
  }

  const isHero = variant === "hero";

  const alertBox =
    "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs leading-snug text-[var(--body)] dark:bg-[var(--card)]";
  const alertBoxHero =
    "rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2.5 text-xs leading-snug text-neutral-200";

  if (status === "success") {
    return (
      <div
        id="regalo"
        className={
          isHero
            ? "scroll-mt-24 w-full min-w-0 max-w-[550px] rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-10 text-left"
            : "rounded-2xl border border-black/10 bg-[var(--card)] p-8"
        }
      >
        <p className={`font-display text-lg ${isHero ? "text-white" : "text-[var(--ink)]"}`}>
          Bienvenido al flujo.
        </p>
        <p className={`mt-4 text-sm leading-relaxed ${isHero ? "text-neutral-400" : "text-[var(--muted)]"}`}>
          Te escribiremos cuando publiquemos algo que merezca tu atención:{" "}
          <strong className={`font-medium ${isHero ? "text-white" : "text-[var(--ink)]"}`}>
            artículos y piezas largas
          </strong>{" "}
          sobre tiempo, foco, economía real, sistema y lo que vaya surgiendo en la revista.
        </p>
        <Link
          href="/#revista"
          className={`mt-8 inline-flex items-center text-sm font-medium transition-colors ${isHero ? "text-neutral-400 hover:text-white" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
        >
          Ir a la revista
        </Link>
      </div>
    );
  }

  const wrap = isHero
    ? "scroll-mt-24 w-full min-w-0 max-w-[550px] overflow-x-hidden text-left"
    : "min-w-0 max-w-full overflow-x-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8";

  return (
    <div id="regalo" className={wrap}>
      {variant === "card" && (
        <>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
            Boletín · Puro Flusso
          </p>
          <h2 className="font-display mt-2 text-2xl text-[var(--ink)] sm:text-3xl">
            La revista, en tu email
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Artículos largos y novedades cuando las haya. Sin promesas mágicas: solo texto con criterio.
          </p>
        </>
      )}
      {isHero && (
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-500">
          Boletín en español · Sin spam
        </p>
      )}
      <form
        onSubmit={onSubmit}
        aria-busy={status === "loading"}
        className={isHero ? "mt-5 min-w-0 w-full space-y-3 text-left" : "mt-6 space-y-4"}
      >
        {isHero ? (
          <>
            <div className="flex min-w-0 w-full max-w-full flex-col gap-2 rounded-lg border border-white/15 bg-black/40 p-1 transition-[border-color,box-shadow] duration-200 focus-within:border-white/28 focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.12)] sm:flex-row sm:items-stretch sm:gap-1">
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-w-0 flex-1 rounded-md border-0 bg-transparent px-4 py-3.5 text-[15px] text-white placeholder:text-neutral-500 focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-white/25 sm:min-h-0 sm:py-3 sm:pl-4"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full shrink-0 rounded-full bg-[#ebe6dc] px-6 py-3.5 text-[15px] font-medium text-neutral-950 transition-[opacity,transform] duration-200 hover:bg-[#f5f0e8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ebe6dc] motion-safe:active:scale-[0.98] disabled:opacity-45 sm:w-auto sm:self-center sm:py-3"
              >
                {status === "loading" ? "Enviando…" : "Suscribirme"}
              </button>
            </div>
            {message && (
              <p className={alertBoxHero} role="alert">
                {message}
              </p>
            )}
            <p className="break-words text-[11px] leading-snug tracking-[0.02em] text-neutral-500">
              {proofHeroText}
            </p>
            <div
              className="min-w-0 w-full max-w-full space-y-2 text-left"
              role="group"
              aria-labelledby={topicsGroupLabelId}
            >
              <p
                id={topicsGroupLabelId}
                className="break-words text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500"
              >
                Opcional · qué te interesa
              </p>
              <div className="flex min-w-0 w-full max-w-full flex-wrap gap-x-3 gap-y-2 sm:gap-x-4">
                {OPTIONAL_TOPICS.map((t) => (
                  <label
                    key={t.slug}
                    className="flex min-w-0 max-w-full cursor-pointer items-start gap-2 text-left text-[11px] text-neutral-300 sm:items-center"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(topicPick[t.slug])}
                      onChange={(e) =>
                        setTopicPick((prev) => ({ ...prev, [t.slug]: e.target.checked }))
                      }
                      className="mt-0.5 size-3.5 shrink-0 rounded border-white/30 bg-transparent text-white accent-[#ebe6dc] sm:mt-0"
                    />
                    <span className="min-w-0 break-words">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex min-w-0 w-full max-w-full cursor-pointer items-start gap-2.5 text-left text-[11px] leading-snug text-neutral-400">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-white/30 bg-transparent accent-[#ebe6dc] focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-0"
              />
              <span className="min-w-0 flex-1 break-words">
                Acepto recibir el boletín de Puro Flusso (artículos, guías y novedades) por email. Puedo
                darme de baja en cualquier momento.
              </span>
            </label>
          </>
        ) : (
          <>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-black/[0.1] bg-[#f5f5f5] px-4 py-3 text-[var(--ink)] placeholder:text-[var(--muted)]/75 focus:border-black/30 focus:outline-none focus:ring-1 focus:ring-black/10 dark:border-[var(--border)] dark:bg-[var(--card)]"
            />
            <div className="min-w-0 w-full max-w-full space-y-2" role="group" aria-labelledby={topicsGroupLabelId}>
              <p id={topicsGroupLabelId} className="break-words text-xs font-medium text-[var(--muted)]">
                Opcional · temas
              </p>
              <div className="flex min-w-0 w-full max-w-full flex-wrap gap-x-3 gap-y-2 sm:gap-x-4">
                {OPTIONAL_TOPICS.map((t) => (
                  <label
                    key={t.slug}
                    className="flex min-w-0 max-w-full cursor-pointer items-start gap-2 text-xs text-[var(--body)] sm:items-center"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(topicPick[t.slug])}
                      onChange={(e) =>
                        setTopicPick((prev) => ({ ...prev, [t.slug]: e.target.checked }))
                      }
                      className="mt-0.5 shrink-0 border-black/30 sm:mt-0"
                    />
                    <span className="min-w-0 break-words">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex min-w-0 w-full max-w-full cursor-pointer items-start gap-3 text-xs leading-relaxed text-[var(--body)]">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 shrink-0 border-black/30"
              />
              <span className="min-w-0 flex-1 break-words">
                Quiero recibir el boletín de Puro Flusso: artículos, guías y novedades (baja cuando quieras).
              </span>
            </label>
            {message && (
              <p className={alertBox} role="alert">
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-xl bg-[var(--ink)] py-3.5 text-sm font-medium text-[var(--cream-wash)] transition-opacity hover:opacity-90 disabled:opacity-45 dark:text-[var(--bg)]"
            >
              {status === "loading" ? "Enviando…" : "Suscribirme"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
