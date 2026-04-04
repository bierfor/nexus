/**
 * JSON-LD for home / organization (ethical SEO — no misleading claims).
 */
export function websiteJsonLd(opts: {
  siteUrl: string;
  name: string;
  description: string;
  locale: string;
}): string {
  const inLang =
    opts.locale === 'en' ? 'en-US' : opts.locale === 'es' ? 'es-ES' : 'pt-BR';
  const data = {
    '@context':    'https://schema.org',
    '@type':       'WebSite',
    name:          opts.name,
    description:   opts.description,
    url:           `${opts.siteUrl}/`,
    inLanguage:    inLang,
    publisher:     {
      '@type': 'NewsMediaOrganization',
      name:    opts.name,
      url:     `${opts.siteUrl}/`,
    },
  };
  return JSON.stringify(data);
}

/** Single flash page — `NewsArticle` for rich results / clarity (facts from CMS). */
export function flashNewsArticleJsonLd(opts: {
  headline: string;
  description: string;
  url: string;
  datePublished: string | null;
  siteUrl: string;
  publisherName: string;
}): string {
  const data: Record<string, unknown> = {
    '@context':         'https://schema.org',
    '@type':            'NewsArticle',
    headline:           opts.headline,
    description:        opts.description,
    mainEntityOfPage:   { '@type': 'WebPage', '@id': opts.url },
    publisher:          {
      '@type': 'NewsMediaOrganization',
      name:    opts.publisherName,
      url:     `${opts.siteUrl.replace(/\/$/, '')}/`,
    },
  };
  if (opts.datePublished) data.datePublished = opts.datePublished;
  return JSON.stringify(data);
}
