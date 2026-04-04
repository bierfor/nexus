import type { HomeHeroContent } from "@/lib/types";

/** Copia de respaldo si aún no hay fila en la base o el hero no está publicado. */
export const DEFAULT_HOME_HERO: HomeHeroContent = {
  slug: "home",
  kicker: "El fin de la obesidad digital",
  headline: "Tu tiempo es puro. Tu flujo también debería serlo.",
  subheadline: null,
  body:
    "¿Qué harías con **40 horas extra al mes**? Menos ruido, más espacio para pensar. El boletín llega solo cuando haya algo que merezca leerse.",
  bodySecondary:
    "Sin cadencia forzada ni promesas vacías: artículos largos y notas cuando toque. Baja cuando quieras.",
  imageUrl:
    "https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=1200&q=82",
  footerCtaLabel: "Ver la revista",
  footerCtaHref: "/#revista",
};
