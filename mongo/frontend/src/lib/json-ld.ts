import type { ArticleDetail } from "@/lib/types";
import { absoluteUrl } from "@/lib/absolute-url";

const ORG_FRAGMENT = "#organization";

export function organizationSchemaId(siteBase: string): string {
  return `${siteBase.replace(/\/$/, "")}${ORG_FRAGMENT}`;
}

export function buildSiteJsonLd(siteBase: string, siteDescription: string) {
  const b = siteBase.replace(/\/$/, "");
  const orgId = organizationSchemaId(b);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: "Puro Flusso",
        url: b,
      },
      {
        "@type": "WebSite",
        "@id": `${b}#website`,
        name: "Puro Flusso",
        url: b,
        inLanguage: "es-ES",
        description: siteDescription,
        publisher: { "@id": orgId },
      },
    ],
  };
}

export function buildArticlePageJsonLd(siteBase: string, article: ArticleDetail) {
  const b = siteBase.replace(/\/$/, "");
  const canonical = absoluteUrl(b, `/articulo/${encodeURIComponent(article.slug)}`);
  const orgId = organizationSchemaId(b);
  const imageUrl = article.coverImage ? absoluteUrl(b, article.coverImage) : undefined;
  const keywords = article.tags.map((t) => t.name).join(", ");
  const dateModified = article.updatedAt || article.publishedAt || undefined;

  const blogPosting: Record<string, unknown> = {
    "@type": "BlogPosting",
    "@id": `${canonical}#article`,
    headline: article.title,
    url: canonical,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    publisher: { "@id": orgId },
    inLanguage: "es-ES",
    isAccessibleForFree: true,
  };

  if (article.excerpt) blogPosting.description = article.excerpt;
  if (article.publishedAt) blogPosting.datePublished = article.publishedAt;
  if (dateModified) blogPosting.dateModified = dateModified;
  if (article.author?.name) {
    blogPosting.author = { "@type": "Person", name: article.author.name };
  }
  if (imageUrl) {
    const img: Record<string, unknown> = { "@type": "ImageObject", url: imageUrl };
    const alt = article.coverImageAlt?.trim();
    if (alt) img.caption = alt;
    blogPosting.image = img;
  }
  if (keywords) blogPosting.keywords = keywords;

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: b },
      { "@type": "ListItem", position: 2, name: article.title, item: canonical },
    ],
  };

  return { "@context": "https://schema.org", "@graph": [blogPosting, breadcrumb] };
}
