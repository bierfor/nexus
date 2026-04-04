import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeHero } from "@/components/home/HomeHero";
import { gql } from "@/lib/graphql";
import { HERO_PREVIEW_QUERY } from "@/lib/queries";
import type { HomeHeroContent } from "@/lib/types";

type HeroPreviewData = { heroPreview: HomeHeroContent | null };

export const metadata: Metadata = {
  title: "Vista previa · Hero",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ slug?: string; token?: string }> };

export default async function PreviewHeroPage(props: Props) {
  const { slug: slugRaw = "home", token } = await props.searchParams;
  const slug = slugRaw.trim() || "home";

  const expected = process.env.HERO_PREVIEW_TOKEN?.trim();
  if (!token || !expected || token !== expected) {
    notFound();
  }

  let hero: HomeHeroContent | null = null;
  try {
    const data = await gql<HeroPreviewData>(
      HERO_PREVIEW_QUERY,
      { slug, previewToken: token },
      { revalidate: 0 },
    );
    hero = data.heroPreview;
  } catch {
    notFound();
  }

  if (!hero) notFound();

  return (
    <div>
      <div className="mb-6 rounded-xl border border-amber-500/35 bg-amber-500/[0.08] px-4 py-3 text-sm text-[var(--ink)]">
        <strong className="font-medium">Vista previa</strong> — contenido que puede ser borrador; no
        indexada. Cierra la pestaña cuando termines.
      </div>
      <p className="mb-4 text-sm">
        <Link href="/" className="font-medium text-[var(--accent)] hover:underline">
          ← Volver a la portada pública
        </Link>
      </p>
      <HomeHero content={hero} />
    </div>
  );
}
