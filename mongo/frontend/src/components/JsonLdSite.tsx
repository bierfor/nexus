import { buildSiteJsonLd } from "@/lib/json-ld";
import { siteUrl } from "@/lib/site-url";

const SITE_DESCRIPTION =
  "El fin de la obesidad digital. Diez horas a la semana recuperando lo esencial. Sin apps complejas.";

export function JsonLdSite() {
  const schema = buildSiteJsonLd(siteUrl(), SITE_DESCRIPTION);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
