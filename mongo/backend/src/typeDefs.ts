export const typeDefs = `#graphql
  type Author {
    id: ID!
    name: String!
    bio: String
    avatarUrl: String
  }

  type Tag {
    id: ID!
    name: String!
    slug: String!
  }

  type Article {
    id: ID!
    title: String!
    slug: String!
    excerpt: String
    content: String!
    coverImage: String
    coverImageAlt: String
    readTimeMinutes: Int
    published: Boolean!
    publishedAt: String
    createdAt: String!
    updatedAt: String!
    viewCount: Int!
    author: Author
    tags: [Tag!]!
  }

  input ArticleInput {
    title: String!
    slug: String!
    excerpt: String
    content: String!
    coverImage: String
    coverImageAlt: String
    readTimeMinutes: Int
    authorId: ID
    tagSlugs: [String!]
    published: Boolean
  }

  input ArticleUpdateInput {
    title: String
    slug: String
    excerpt: String
    content: String
    coverImage: String
    coverImageAlt: String
    readTimeMinutes: Int
    authorId: ID
    tagSlugs: [String!]
    published: Boolean
  }

  type Hero {
    id: ID!
    slug: String!
    kicker: String
    headline: String!
    subheadline: String
    body: String!
    bodySecondary: String
    imageUrl: String
    footerCtaLabel: String
    footerCtaHref: String
    published: Boolean!
    updatedAt: String!
  }

  type BotApiToken {
    id: ID!
    name: String!
    """Identificador público del token (prefijo pfbot_ mas keyId en el Bearer)."""
    keyId: String!
    scopes: [String!]!
    enabled: Boolean!
    lastUsedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type CreateBotApiTokenPayload {
    """Bearer completo (pfbot_keyId.secreto). Solo se devuelve al crear."""
    token: String!
    botApiToken: BotApiToken!
  }

  input BotApiTokenCreateInput {
    name: String!
    scopes: [String!]!
  }

  input BotApiTokenUpdateInput {
    name: String
    scopes: [String!]
    enabled: Boolean
  }

  type FlashNews {
    id: ID!
    title: String!
    slug: String!
    summary: String!
    sourceLabel: String
    sourceUrl: String
    hack: String
    published: Boolean!
    publishedAt: String
    createdAt: String!
    updatedAt: String!
  }

  input FlashNewsInput {
    title: String!
    """Si se omite o queda vacío, el backend genera un slug único a partir del título."""
    slug: String
    summary: String!
    sourceLabel: String
    sourceUrl: String
    hack: String
    published: Boolean
  }

  input FlashNewsUpdateInput {
    title: String
    slug: String
    summary: String
    sourceLabel: String
    sourceUrl: String
    hack: String
    published: Boolean
  }

  input HeroUpsertInput {
    slug: String!
    kicker: String
    headline: String!
    subheadline: String
    body: String!
    bodySecondary: String
    imageUrl: String
    footerCtaLabel: String
    footerCtaHref: String
    published: Boolean
  }

  type Query {
    articles(publishedOnly: Boolean = true): [Article!]!
    article(slug: String!): Article
    articleDraft(slug: String!): Article
    """Artículo completo por id (solo admin; borradores incluidos)."""
    articleAdmin(id: ID!): Article
    """Hero publicado por slug (p. ej. home). Null si no existe o no está publicado."""
    hero(slug: String!): Hero
    """Hero por slug incl. borrador; requiere HERO_PREVIEW_TOKEN en el backend y el mismo token aquí."""
    heroPreview(slug: String!, previewToken: String!): Hero
    """Hero por slug — admin; incluye borradores."""
    heroAdmin(slug: String!): Hero
    """Listado de todos los bloques hero — admin."""
    heroesAdmin: [Hero!]!
    """Listado completo de flashes — admin (sin límite de la query pública)."""
    flashNewsAdminList: [FlashNews!]!
    flashNews(publishedOnly: Boolean = true, limit: Int = 6): [FlashNews!]!
    flashNewsAdmin(id: ID!): FlashNews
    """Listado de tokens de API para integraciones — solo admin humano."""
    botApiTokens: [BotApiToken!]!
    """Permisos que se pueden asignar a un token de bot."""
    botAvailableScopes: [String!]!
    tags: [Tag!]!
    authors: [Author!]!
  }

  type Mutation {
    createArticle(input: ArticleInput!): Article!
    updateArticle(id: ID!, input: ArticleUpdateInput!): Article!
    deleteArticle(id: ID!): Boolean!
    publishArticle(id: ID!): Article!
    unpublishArticle(id: ID!): Article!
    """Suma una vista a un artículo publicado (público; limitado por IP). Devuelve el total actual."""
    recordArticleView(slug: String!): Int!
    """Crea o actualiza un bloque hero (identificado por slug)."""
    upsertHero(input: HeroUpsertInput!): Hero!
    """Elimina un bloque hero por slug (solo admin humano)."""
    deleteHero(slug: String!): Boolean!
    createFlashNews(input: FlashNewsInput!): FlashNews!
    updateFlashNews(id: ID!, input: FlashNewsUpdateInput!): FlashNews!
    deleteFlashNews(id: ID!): Boolean!
    publishFlashNews(id: ID!): FlashNews!
    unpublishFlashNews(id: ID!): FlashNews!
    createBotApiToken(input: BotApiTokenCreateInput!): CreateBotApiTokenPayload!
    updateBotApiToken(id: ID!, input: BotApiTokenUpdateInput!): BotApiToken!
    revokeBotApiToken(id: ID!): Boolean!
  }
`;
