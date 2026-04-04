export const SITEMAP_ARTICLES_QUERY = `
  query SitemapArticles {
    articles(publishedOnly: true) {
      slug
      publishedAt
      updatedAt
    }
  }
`;

export const HERO_QUERY = `
  query Hero($slug: String!) {
    hero(slug: $slug) {
      slug
      kicker
      headline
      subheadline
      body
      bodySecondary
      imageUrl
      footerCtaLabel
      footerCtaHref
    }
  }
`;

export const HERO_PREVIEW_QUERY = `
  query HeroPreview($slug: String!, $previewToken: String!) {
    heroPreview(slug: $slug, previewToken: $previewToken) {
      slug
      kicker
      headline
      subheadline
      body
      bodySecondary
      imageUrl
      footerCtaLabel
      footerCtaHref
    }
  }
`;

export const ARTICLES_QUERY = `
  query Articles {
    articles(publishedOnly: true) {
      id
      title
      slug
      excerpt
      readTimeMinutes
      viewCount
      publishedAt
      coverImage
      coverImageAlt
      author {
        name
      }
      tags {
        name
        slug
      }
    }
  }
`;

export const ARTICLE_BY_SLUG_QUERY = `
  query ArticleBySlug($slug: String!) {
    article(slug: $slug) {
      id
      title
      slug
      excerpt
      content
      readTimeMinutes
      viewCount
      publishedAt
      updatedAt
      coverImage
      coverImageAlt
      author {
        name
        bio
      }
      tags {
        name
        slug
      }
    }
  }
`;

export const FLASH_NEWS_QUERY = `
  query FlashNews {
    flashNews(publishedOnly: true, limit: 8) {
      id
      title
      slug
      summary
      sourceLabel
      sourceUrl
      hack
      publishedAt
    }
  }
`;
