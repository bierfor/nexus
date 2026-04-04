import type { MetadataRoute } from "next";
import { gql } from "@/lib/graphql";
import { SITEMAP_ARTICLES_QUERY } from "@/lib/queries";
import { siteUrl } from "@/lib/site-url";

type SitemapArticle = {
  slug: string;
  publishedAt: string | null;
  updatedAt: string;
};

function lastMod(a: SitemapArticle): Date {
  const raw = a.updatedAt || a.publishedAt;
  if (!raw) return new Date();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const entries: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/legal/aviso-legal`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.25,
    },
    {
      url: `${base}/legal/privacidad`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.25,
    },
    {
      url: `${base}/revista`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.85,
    },
  ];

  try {
    const data = await gql<{ articles: SitemapArticle[] }>(SITEMAP_ARTICLES_QUERY, undefined, {
      revalidate: 3600,
      tags: ["articles"],
    });
    for (const a of data.articles) {
      entries.push({
        url: `${base}/articulo/${encodeURIComponent(a.slug)}`,
        lastModified: lastMod(a),
        changeFrequency: "monthly",
        priority: 0.75,
      });
    }
  } catch {
    /* build o API caída: al menos páginas estáticas */
  }

  return entries;
}
