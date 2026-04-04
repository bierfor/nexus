import { FadeInSection } from "@/components/FadeInSection";
import { HomeFlashNews } from "@/components/home/HomeFlashNews";
import { HomeHero } from "@/components/home/HomeHero";
import { RevistaArticleCard } from "@/components/RevistaArticleCard";
import { RevistaFeaturedCard } from "@/components/RevistaFeaturedCard";
import { gql } from "@/lib/graphql";
import { ARTICLES_QUERY, FLASH_NEWS_QUERY, HERO_QUERY } from "@/lib/queries";
import type { ArticleSummary, FlashNewsSummary, HomeHeroContent } from "@/lib/types";

type ArticlesData = { articles: ArticleSummary[] };
type HeroData = { hero: HomeHeroContent | null };
type FlashNewsData = { flashNews: FlashNewsSummary[] };

const PREFERRED_FEATURED_SLUG = "calendario-google-minimalismo-digital";

/** Etiquetas de artículo que marcan pieza tipo relámpago (no deben repetirse en “Más lecturas”). */
const FLASH_ARTICLE_TAG_SLUGS = new Set(["flash", "relampago", "noticia-relampago", "noticias-relampago"]);

function normalizeTitleKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isArticleOnlyNews(
  a: ArticleSummary,
  flashSlugs: Set<string>,
  flashTitleKeys: Set<string>,
) {
  if (flashSlugs.has(a.slug)) return false;
  if (flashTitleKeys.has(normalizeTitleKey(a.title))) return false;
  if (a.tags.some((t) => FLASH_ARTICLE_TAG_SLUGS.has(t.slug))) return false;
  return true;
}

export default async function Home() {
  let articles: ArticleSummary[] = [];
  let fetchError: string | null = null;

  let hero: HomeHeroContent | null = null;
  let flashNews: FlashNewsSummary[] = [];
  const homeHeroSlug =
    (process.env.NEXT_PUBLIC_HOME_HERO_SLUG ?? "home").trim() || "home";

  const [articlesRes, heroRes, flashRes] = await Promise.allSettled([
    gql<ArticlesData>(ARTICLES_QUERY, undefined, {
      tags: ["articles"],
    }),
    gql<HeroData>(HERO_QUERY, { slug: homeHeroSlug }, { tags: ["heroes"] }),
    gql<FlashNewsData>(FLASH_NEWS_QUERY, undefined, { tags: ["flash-news"] }),
  ]);

  if (articlesRes.status === "fulfilled") {
    articles = articlesRes.value.articles;
  } else {
    const e = articlesRes.reason;
    fetchError = e instanceof Error ? e.message : "Error al conectar con la API";
  }

  if (heroRes.status === "fulfilled") {
    hero = heroRes.value.hero;
  } else {
    hero = null;
  }

  if (flashRes.status === "fulfilled") {
    flashNews = flashRes.value.flashNews;
  } else {
    flashNews = [];
  }

  const flashSlugs = new Set(flashNews.map((f) => f.slug.trim()));
  const flashTitleKeys = new Set(flashNews.map((f) => normalizeTitleKey(f.title)));

  const featured =
    articles.find((a) => a.slug === PREFERRED_FEATURED_SLUG) ?? articles[0] ?? null;

  const moreFromRevista = featured
    ? articles.filter(
        (a) => a.id !== featured.id && isArticleOnlyNews(a, flashSlugs, flashTitleKeys),
      )
    : articles.filter((a) => isArticleOnlyNews(a, flashSlugs, flashTitleKeys));

  return (
    <div className="min-w-0">
      <HomeHero content={hero} />

      <section
        id="revista"
        className="render-optimized scroll-mt-[calc(4.25rem+0.75rem)] overflow-x-hidden border-t border-[var(--border)] bg-[var(--bg)] pb-28 pt-20 md:pb-32 md:pt-24"
      >
        <FadeInSection className="mx-auto max-w-4xl px-1 sm:px-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
            Desde la revista
          </p>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-[var(--body)]">
            Ideas para recuperar tiempo y claridad, sin ruido — en formato revista.
          </p>

          {fetchError ? (
            <div className="mt-12 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-8 text-sm text-[var(--body)] dark:bg-[var(--card)]">
              <p className="font-medium text-[var(--ink)]">Sin conexión a la revista</p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{fetchError}</p>
            </div>
          ) : (
            <div className="mt-12 space-y-14 md:mt-14 md:space-y-20">
              <div>
                {featured && (
                  <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                    Destacado
                  </p>
                )}
                <RevistaFeaturedCard article={featured} emptyVariant={fetchError ? "error" : "soon"} />
              </div>
              {flashNews.length > 0 && <HomeFlashNews items={flashNews} />}
              {moreFromRevista.length > 0 && (
                <div>
                  <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                    Más lecturas
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                    {moreFromRevista.map((a) => (
                      <RevistaArticleCard key={a.id} article={a} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </FadeInSection>
      </section>
    </div>
  );
}
