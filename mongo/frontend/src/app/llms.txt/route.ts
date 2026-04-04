import { siteUrl } from "@/lib/site-url";

/** URL canónica resuelta en cada petición (env de despliegue). */
export const dynamic = "force-dynamic";

export function GET() {
  const base = siteUrl().replace(/\/$/, "");
  const body = `# Puro Flusso

> Publicación en español sobre minimalismo digital, productividad consciente y flujo de trabajo sin ruido innecesario.

## Enlaces útiles

- [Índice / portada](${base}/)
- [Mapa del sitio (lista de URLs de artículos)](${base}/sitemap.xml)
- [Política de privacidad](${base}/legal/privacidad)
- [Aviso legal](${base}/legal/aviso-legal)

## Estructura del contenido

Cada artículo publicado tiene una URL estable y canónica:

\`${base}/articulo/<slug>\`

El listado actualizado de \`slug\` aparece en \`sitemap.xml\`. El cuerpo del texto está en la página HTML dentro del elemento \`<article>\` (título en \`<h1>\`, metadatos en \`<header>\`, contenido en la zona \`prose\`).

## Citas

Para citar o enlazar, usa la URL canónica del artículo. Los metadatos Open Graph y datos estructurados JSON-LD (schema.org BlogPosting) reflejan título, descripción, fechas, autor e imagen cuando existan.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
