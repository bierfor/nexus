import { gql } from "@/lib/graphql";
import { ARTICLES_QUERY } from "@/lib/queries";
import { absoluteUrl } from "@/lib/absolute-url";
import { siteUrl } from "@/lib/site-url";
import type { ArticleSummary } from "@/lib/types";

/**
 * Caracteres no permitidos en XML 1.0 (rompen el parseo en Google y validadores).
 * @see https://www.w3.org/TR/xml/#charsets
 */
function stripXmlInvalidChars(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function escXml(s: string): string {
  return stripXmlInvalidChars(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * RSS 2.0 exige pubDate en formato RFC 822 (no basta con Date.toUTCString() en todos los entornos).
 * @see https://www.rssboard.org/rss-specification
 */
function rssPubDate(d: Date): string {
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ] as const;
  const day = days[safe.getUTCDay()];
  const dom = safe.getUTCDate();
  const mon = months[safe.getUTCMonth()];
  const y = safe.getUTCFullYear();
  const hh = String(safe.getUTCHours()).padStart(2, "0");
  const mm = String(safe.getUTCMinutes()).padStart(2, "0");
  const ss = String(safe.getUTCSeconds()).padStart(2, "0");
  return `${day}, ${dom} ${mon} ${y} ${hh}:${mm}:${ss} GMT`;
}

/** No pregenerar el feed en build (GraphQL suele fallar en CI → canal vacío y Google rechaza el feed). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const base = siteUrl().replace(/\/$/, "");
  const feedSelf = absoluteUrl(base, "/feed.xml");

  let articles: ArticleSummary[] = [];
  try {
    const data = await gql<{ articles: ArticleSummary[] }>(ARTICLES_QUERY, undefined, {
      revalidate: 0,
      tags: ["articles"],
    });
    articles = Array.isArray(data.articles) ? data.articles : [];
  } catch {
    articles = [];
  }

  const parsedDates = articles
    .map((a) => (a.publishedAt ? new Date(a.publishedAt) : null))
    .filter((d): d is Date => d != null && !Number.isNaN(d.getTime()));
  const newestArticle =
    parsedDates.length > 0 ? new Date(Math.max(...parsedDates.map((d) => d.getTime()))) : null;
  const channelPubDate = rssPubDate(newestArticle ?? new Date());
  const lastBuildDate = rssPubDate(new Date());

  const items = articles
    .map((a) => {
      const link = absoluteUrl(base, `/articulo/${encodeURIComponent(a.slug)}`);
      const pub = a.publishedAt ? new Date(a.publishedAt) : null;
      const pubOk = pub && !Number.isNaN(pub.getTime()) ? pub : newestArticle ?? new Date();
      const rawDesc = stripXmlInvalidChars(a.excerpt?.trim() || a.title).trim() || a.title;

      return `    <item>
      <title>${escXml(a.title)}</title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="true">${escXml(link)}</guid>
      <pubDate>${rssPubDate(pubOk)}</pubDate>
      <description>${escXml(rawDesc)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml("Puro Flusso — Revista")}</title>
    <link>${escXml(base)}</link>
    <description>${escXml("Artículos y piezas largas de Puro Flusso.")}</description>
    <language>es</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <pubDate>${channelPubDate}</pubDate>
    <generator>Next.js — Puro Flusso</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <atom:link href="${escXml(feedSelf)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
