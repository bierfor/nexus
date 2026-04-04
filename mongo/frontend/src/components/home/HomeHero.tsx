import Image from "next/image";
import Link from "next/link";
import type { HomeHeroContent } from "@/lib/types";
import { DEFAULT_HOME_HERO } from "@/lib/default-home-hero";
import { HomeHeroFormSlot } from "@/components/home/HomeHeroFormSlot";
import { HeroRichParagraphs } from "@/components/home/HeroRichText";
import { SmoothPointer } from "@/components/ui/SmoothPointer";

type Props = {
  content: HomeHeroContent | null;
};

/**
 * Hero de portada: textos e imagen desde la base (`hero(slug: "home")`) con fallback local.
 * Tema oscuro editorial (mockup): dos columnas equilibradas, imagen con esquinas ~2rem.
 */
export function HomeHero({ content }: Props) {
  const c = content ?? DEFAULT_HOME_HERO;
  const imageSrc = c.imageUrl?.trim() || DEFAULT_HOME_HERO.imageUrl!;
  const footerLabel = c.footerCtaLabel?.trim() || DEFAULT_HOME_HERO.footerCtaLabel!;
  const footerHref = c.footerCtaHref?.trim() || DEFAULT_HOME_HERO.footerCtaHref!;

  const heroImageAlt =
    c.headline.length > 90 ? `${c.headline.slice(0, 87)}…` : c.headline;

  return (
    <section
      className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-hidden border-b border-white/[0.08] bg-[#0a0a0a] text-neutral-300"
      aria-labelledby="hero-heading"
    >
      {/* Transición suave al bloque claro de la revista */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/35 to-transparent md:h-40"
        aria-hidden
      />
      <div className="relative mx-auto w-full min-w-0 max-w-6xl px-5 py-16 sm:py-20 md:px-6 md:py-24 lg:py-28">
        <div className="grid w-full min-w-0 grid-cols-1 items-center justify-items-center gap-12 md:min-h-[min(42rem,calc(100svh-6.5rem))] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:justify-items-stretch md:gap-14 lg:min-h-[min(44rem,calc(100svh-6.5rem))] lg:gap-16">
          <div className="mx-auto w-full min-w-0 max-w-2xl text-left md:mx-0 md:max-w-none md:pr-6">
            {c.kicker?.trim() ? (
              <p className="hero-reveal hero-reveal-delay-micro break-words text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-500">
                {c.kicker.trim()}
              </p>
            ) : null}
            <h1
              id="hero-heading"
              className="hero-reveal hero-reveal-delay-title font-display mt-4 break-words text-[clamp(2.1rem,3.6vw+1rem,3.35rem)] font-medium leading-[1.06] tracking-[-0.02em] text-white"
            >
              <span className="block">{c.headline}</span>
              {c.subheadline?.trim() ? (
                <span className="mt-2 block break-words text-lg font-normal text-neutral-400 sm:text-xl">
                  {c.subheadline.trim()}
                </span>
              ) : null}
            </h1>
            <div className="hero-reveal hero-reveal-delay-body">
              <HeroRichParagraphs
                text={c.body}
                strongClassName="font-medium text-white"
                paragraphClassName="mt-6 max-w-lg break-words text-[0.9375rem] leading-[1.72] text-neutral-400"
              />
            </div>
            {c.bodySecondary?.trim() ? (
              <div className="hero-reveal hero-reveal-delay-body">
                <HeroRichParagraphs
                  text={c.bodySecondary.trim()}
                  strongClassName="font-medium text-white"
                  paragraphClassName="mt-4 max-w-lg break-words text-sm leading-relaxed text-neutral-500"
                />
              </div>
            ) : null}
            <div className="hero-reveal hero-reveal-delay-form mt-9 min-w-0 w-full max-w-[550px]">
              <HomeHeroFormSlot />
            </div>
          </div>

          <div className="flex min-w-0 max-w-full justify-center md:justify-end">
            <figure className="hero-reveal hero-reveal-delay-visual relative w-full min-w-0 max-w-[min(100%,20rem)] md:max-w-[min(100%,28rem)]">
              <SmoothPointer className="motion-safe:transform-gpu motion-safe:transition-transform motion-safe:duration-300 md:hover:scale-[1.01]">
                <div className="overflow-hidden rounded-[2rem] bg-neutral-900 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.08]">
                  <div className="relative aspect-[4/5]">
                    <Image
                      src={imageSrc}
                      alt={heroImageAlt}
                      fill
                      priority
                      sizes="(max-width: 767px) 90vw, (max-width: 1024px) 42vw, 448px"
                      className="object-cover object-[center_38%] [filter:none] [-webkit-filter:none] [forced-color-adjust:none]"
                    />
                  </div>
                </div>
              </SmoothPointer>
            </figure>
          </div>
        </div>

        <div className="relative mt-14 flex min-w-0 justify-center px-1 md:mt-16">
          {/^https?:\/\//i.test(footerHref) ? (
            <a
              href={footerHref}
              className="break-words rounded-sm text-sm font-medium text-neutral-500 transition-colors duration-200 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/40"
              rel="noopener noreferrer"
            >
              {footerLabel}
            </a>
          ) : (
            <Link
              href={footerHref}
              className="break-words rounded-sm text-sm font-medium text-neutral-500 transition-colors duration-200 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/40"
            >
              {footerLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
