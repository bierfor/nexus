import gql from 'graphql-tag';

export const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String!
    plan: String!
    role: String!
    """Stripe subscription.status mirror when subscribed; empty if none."""
    stripeSubscriptionStatus: String!
    """ISO 8601 end of current paid period, or empty."""
    billingPeriodEndsAt: String!
    """True when the user can open the Stripe Customer Portal (has a Stripe customer)."""
    billingPortalAvailable: Boolean!
    """
    Premium/Business: whether the sponsored interstitial may appear on links that still use the Free tier snapshot.
    Always true for Free-plan accounts (they cannot disable). Default true for paid accounts.
    """
    shortLinkAdsEnabled: Boolean!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Link {
    id: ID!
    slug: String!
    targetUrl: String!
    clicks: Int!
    adImpressions: Int!
    plan: String!
    ownerId: ID
    ownerEmail: String
    createdAt: String!
    """
    When false, the short-link interstitial is skipped for this link (paid owner disabled ads for free-tier snapshot links).
    """
    linkInterstitialAllowed: Boolean!
  }

  type Metrics {
    adImpressions: Int!
  }

  type AdPlacement {
    id: ID!
    title: String!
    body: String!
    targetUrl: String!
    imageUrl: String!
    regions: String!
    priority: Int!
    active: Boolean!
    audiencePlan: String!
    createdAt: String!
  }

  input AdPlacementInput {
    id: ID
    title: String!
    body: String
    targetUrl: String!
    imageUrl: String
    regions: String
    priority: Int
    active: Boolean
    audiencePlan: String
  }

  type AdminAnalyticsSummary {
    rawClicks: Int!
    uniqueClickers: Int!
    botSkipsRecorded: Int!
    siteViewsRaw: Int!
    siteViewsUnique: Int!
    """Dashboard sponsored tile loads (in-app)."""
    adImpressions: Int!
    """Short-link interstitial gate views (free-plan links only)."""
    shortlinkGateImpressions: Int!
    """Clicks on sponsored creative outbound URL from the gate."""
    adOutboundClicks: Int!
  }

  type AdminDailySeriesPoint {
    date: String!
    rawClicks: Int!
    uniqueClickers: Int!
    siteViewsRaw: Int!
    siteViewsUnique: Int!
  }

  type AdminTopLinkStat {
    slug: String!
    targetUrl: String!
    rawClicks: Int!
    uniqueClickers: Int!
  }

  type AdminTopPathStat {
    path: String!
    views: Int!
    uniqueVisitors: Int!
  }

  type AdminUserCounts {
    total: Int!
    newInPeriod: Int!
  }

  """Platform analytics: raw vs deduped visitors, funnels, monetization inputs."""
  type AdminAnalytics {
    periodDays: Int!
    fromIso: String!
    toIso: String!
    summary: AdminAnalyticsSummary!
    daily: [AdminDailySeriesPoint!]!
    topLinks: [AdminTopLinkStat!]!
    topPaths: [AdminTopPathStat!]!
    users: AdminUserCounts!
    linksTotal: Int!
  }

  type Query {
    me: User
    myLinks(limit: Int = 100): [Link!]!
    linkBySlug(slug: String!): Link
    metrics: Metrics!
    """Active sponsored tile for this region + viewer subscription (free only by default)."""
    adForViewer(region: String!, viewerPlan: String!): AdPlacement
    adminUsers: [User!]!
    adminAds: [AdPlacement!]!
    adminLinks(limit: Int = 200): [Link!]!
    """Aggregated clicks, uniques, site flow — admin only. periodDays 1–365."""
    adminAnalytics(periodDays: Int = 30): AdminAnalytics!
  }

  type Mutation {
    """
    botField must stay empty (hidden honeypot). Non-empty requests are rejected to reduce automated signups.
    """
    register(email: String!, password: String!, name: String, botField: String): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    logout: Boolean!
    createShortLink(targetUrl: String!, customSlug: String): Link!
    """Update a link you own (destination URL and/or slug)."""
    updateMyLink(id: ID!, targetUrl: String!, slug: String!): Link!
    """Delete a link you own."""
    deleteMyLink(id: ID!): Boolean!
    recordClick(slug: String!): Boolean!
    """Anonymous marketing path view; session-deduped in the browser. IP+UA hashed server-side."""
    recordSitePageView(path: String!): Boolean!
    recordAdImpression: Boolean!
    """Free short-link interstitial shown; increments Link.adImpressions + gate metric."""
    recordLinkGateView(slug: String!): Boolean!
    """Visitor opened the sponsored offer from the interstitial (new tab)."""
    recordPlacementOutboundClick(adId: ID!): Boolean!
    adminUpdateUserPlan(userId: ID!, plan: String!): User!
    """
    Start Stripe Checkout for a recurring subscription (premium or business).
    Returns the hosted Checkout URL. Rejects if the user already has that tier or higher with an active paid subscription.
    """
    createBillingCheckoutSession(tier: String!): String!
    """Stripe Customer Portal URL to manage payment method, cancel, or switch plans where allowed."""
    createBillingPortalSession: String!
    """
    Upgrade an existing Premium subscription to Business in-place (proration).
    Use when the user already has an active Premium Stripe subscription.
    """
    upgradeBillingSubscriptionToBusiness: Boolean!
    """
    Premium/Business only: enable or disable the sponsored interstitial for your links that still carry the Free plan snapshot.
    """
    updateMyShortLinkAdsPreference(enabled: Boolean!): User!
    adminUpsertAd(input: AdPlacementInput!): AdPlacement!
    adminDeleteAd(id: ID!): Boolean!
  }
`;
