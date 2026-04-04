"use client";

import { useState } from "react";

export function ArticleShare({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onShare() {
    setErr(null);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setErr("No se pudo abrir el menú de compartir.");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setErr("No se pudo copiar el enlace.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void onShare()}
        className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--card)]"
      >
        {copied ? "Enlace copiado" : "Compartir"}
      </button>
      {err && (
        <p className="text-xs text-[var(--muted)]" role="status">
          {err}
        </p>
      )}
    </div>
  );
}
