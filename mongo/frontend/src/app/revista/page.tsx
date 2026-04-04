import type { Metadata } from "next";
import Link from "next/link";
import { FadeInSection } from "@/components/FadeInSection";
import { RevistaArchive } from "@/components/revista/RevistaArchive";
import { gql } from "@/lib/graphql";
import { ARTICLES_QUERY } from "@/lib/queries";
import type { ArticleSummary } from "@/lib/types";

export const metadata: Metadata = {
  title: "Revista",
  description: "Archivo de artículos y piezas largas de Puro Flusso.",
  alternates: { canonical: "/revista" },
  openGraph: {
    title: "Revista · Puro Flusso",
    description: "Archivo de artículos y piezas largas de Puro Flusso.",
    url: "/revista",
  },
};

type ArticlesData = { articles: ArticleSummary[] };

export default async function RevistaPage() {
  let articles: ArticleSummary[] = [];
  let fetchError: string | null = null;
  try {
    const data = await gql<ArticlesData>(ARTICLES_QUERY, undefined, {
      tags: ["articles"],
    });
    articles = data.articles;
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "Error al conectar con la API";
  }

  return (
    <div className="render-optimized">
      <FadeInSection className="mx-auto max-w-4xl px-1 sm:px-0">
        <Link
          href="/"
          className="rounded-sm text-sm font-medium text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]/35"
        >
          ← Portada
        </Link>
        <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
          Revista
        </p>
        <h1 className="font-display mt-3 text-3xl font-medium tracking-tight text-[var(--ink)] sm:text-4xl">
          Archivo
        </h1>
        <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-[var(--body)]">
          Todas las lecturas publicadas. Filtra por etiqueta si quieres acotar.
        </p>

        <div className="mt-12">
          <RevistaArchive articles={articles} fetchError={fetchError} />
        </div>
      </FadeInSection>
    </div>
  );
}
