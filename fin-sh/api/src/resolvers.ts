import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Types } from 'mongoose';
import {
  clientUa,
  computeAdminAnalytics,
  normalizeSitePath,
  utcDayString,
  visitorDayFingerprint,
} from './analytics.js';
import { AdPlacement, ClickEvent, Link, Metric, SiteVisit, User } from './models.js';
import {
  createSessionForUser,
  destroySession,
  hashPassword,
  serializeUser,
  verifyPassword,
  type AuthUser,
} from './auth.js';
import { assertStrongPassword } from './auth-password.js';
import {
  assertAuthRateAllowed,
  clearAuthFailures,
  recordAuthFailure,
} from './auth-rate-limit.js';
import { applySubscriptionState } from './stripe-sync.js';
import {
  billingAppOrigin,
  getBusinessPriceId,
  getPremiumPriceId,
  getStripe,
  isPaidSubscriptionStatus,
  planRank,
} from './stripe-billing.js';

function randomSlug(len = 7): string {
  const raw = randomBytes(12).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
  return (raw.slice(0, len) || 'link').toLowerCase();
}

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isLikelyBot(ua: string | undefined): boolean {
  if (!ua) return false;
  return /bot|crawl|spider|preview|slack|twitter|facebook|linkedin|whatsapp/i.test(ua);
}

export type CookieState = {
  setSession?: string;
  clearSession: boolean;
};

export type GqlContext = {
  req: IncomingMessage;
  user: AuthUser | null;
  cookieState: CookieState;
};

function requireAuth(ctx: GqlContext): AuthUser {
  if (!ctx.user) throw new Error('Unauthorized');
  return ctx.user;
}

function requireAdmin(ctx: GqlContext): AuthUser {
  const u = requireAuth(ctx);
  if (u.role !== 'admin') throw new Error('Forbidden');
  return u;
}

function matchesRegion(regionsCsv: string, country: string): boolean {
  const c = country.trim().toUpperCase() || 'US';
  const parts = regionsCsv
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0 || parts.includes('*')) return true;
  return parts.includes(c);
}

/** Paid owners may disable the interstitial for Free-tier snapshot links; everyone else keeps ads when applicable. */
function linkInterstitialAllowedForOwner(
  owner: { plan?: string; shortLinkAdsEnabled?: boolean } | null | undefined,
): boolean {
  if (!owner) return true;
  const p = String(owner.plan ?? 'free').toLowerCase();
  if (p === 'premium' || p === 'business') return owner.shortLinkAdsEnabled !== false;
  return true;
}

export const resolvers = {
  Query: {
    me: (_: unknown, __: unknown, ctx: GqlContext) => (ctx.user ? serializeUser(ctx.user) : null),

    myLinks: async (_: unknown, args: { limit?: number }, ctx: GqlContext) => {
      const u = requireAuth(ctx);
      const lim = Math.min(Math.max(args.limit ?? 100, 1), 500);
      const docs = (await Link.find({ ownerId: u._id }).sort({ createdAt: -1 }).limit(lim).lean()) as any[];
      return docs.map((d) => serializeLink(d, null, linkInterstitialAllowedForOwner(u)));
    },

    linkBySlug: async (_: unknown, args: { slug: string }) => {
      const doc = (await Link.findOne({ slug: args.slug }).lean()) as any;
      if (!doc) return null;
      let ownerEmail: string | null = null;
      let allowed = true;
      if (doc.ownerId) {
        const owner = (await User.findById(doc.ownerId)
          .select('email plan shortLinkAdsEnabled')
          .lean()) as any;
        ownerEmail = owner?.email ?? null;
        allowed = linkInterstitialAllowedForOwner(owner);
      }
      return serializeLink(doc, ownerEmail, allowed);
    },

    metrics: async () => {
      const m = (await Metric.findOne({ key: 'ad_impressions' }).lean()) as any;
      return { adImpressions: m?.count ?? 0 };
    },

    adForViewer: async (
      _: unknown,
      args: { region: string; viewerPlan: string },
    ) => {
      const plan = (args.viewerPlan ?? 'free').toLowerCase();
      if (plan !== 'free') return null;
      const region = args.region || 'US';
      const ads = (await AdPlacement.find({ active: true }).sort({ priority: -1 }).lean()) as any[];
      for (const a of ads) {
        if (a.audiencePlan === 'all' || a.audiencePlan === 'free') {
          if (matchesRegion(a.regions ?? '*', region)) {
            return serializeAd(a);
          }
        }
      }
      return null;
    },

    adminUsers: async (_: unknown, __: unknown, ctx: GqlContext) => {
      requireAdmin(ctx);
      const docs = (await User.find().sort({ createdAt: -1 }).limit(500).lean()) as any[];
      return docs.map((d) => serializeUser(d));
    },

    adminAds: async (_: unknown, __: unknown, ctx: GqlContext) => {
      requireAdmin(ctx);
      const docs = (await AdPlacement.find().sort({ priority: -1 }).lean()) as any[];
      return docs.map(serializeAd);
    },

    adminLinks: async (_: unknown, args: { limit?: number }, ctx: GqlContext) => {
      requireAdmin(ctx);
      const lim = Math.min(Math.max(args.limit ?? 200, 1), 1000);
      const docs = (await Link.find().sort({ createdAt: -1 }).limit(lim).lean()) as any[];
      const out = [];
      for (const d of docs) {
        let ownerEmail: string | null = null;
        if (d.ownerId) {
          const owner = (await User.findById(d.ownerId)
            .select('email plan shortLinkAdsEnabled')
            .lean()) as any;
          ownerEmail = owner?.email ?? null;
          out.push(serializeLink(d, ownerEmail, linkInterstitialAllowedForOwner(owner)));
        } else {
          out.push(serializeLink(d, null, true));
        }
      }
      return out;
    },

    adminAnalytics: async (_: unknown, args: { periodDays?: number | null }, ctx: GqlContext) => {
      requireAdmin(ctx);
      const days = args.periodDays ?? 30;
      return computeAdminAnalytics(days);
    },
  },

  Mutation: {
    register: async (
      _: unknown,
      args: { email: string; password: string; name?: string | null; botField?: string | null },
      ctx: GqlContext,
    ) => {
      assertAuthRateAllowed(ctx.req, 'register');
      const trap = String(args.botField ?? '').trim();
      if (trap) {
        recordAuthFailure(ctx.req, 'register');
        throw new Error(
          'We could not create an account with those details. Try signing in or use a different email.',
        );
      }

      const email = args.email.trim().toLowerCase();
      if (!email.includes('@') || email.length > 254) {
        recordAuthFailure(ctx.req, 'register');
        throw new Error('Invalid email address');
      }

      try {
        assertStrongPassword(args.password);
      } catch (e) {
        recordAuthFailure(ctx.req, 'register');
        throw e;
      }

      const name = (args.name ?? '').trim().slice(0, 120);
      const exists = await User.exists({ email });
      if (exists) {
        recordAuthFailure(ctx.req, 'register');
        throw new Error(
          'We could not create an account with those details. Try signing in or use a different email.',
        );
      }

      const passwordHash = await hashPassword(args.password);
      const user = await User.create({
        email,
        passwordHash,
        name,
        plan: 'free',
        role: 'user',
      });
      const token = await createSessionForUser(user._id);
      ctx.cookieState.setSession = token;
      clearAuthFailures(ctx.req, 'register');
      return { token, user: serializeUser(user.toObject()) };
    },

    login: async (_: unknown, args: { email: string; password: string }, ctx: GqlContext) => {
      assertAuthRateAllowed(ctx.req, 'login');
      const email = args.email.trim().toLowerCase();
      if (!email.includes('@') || email.length > 254) {
        recordAuthFailure(ctx.req, 'login');
        throw new Error('Invalid email or password');
      }
      const user = (await User.findOne({ email }).lean()) as any;
      if (!user || !(await verifyPassword(args.password, user.passwordHash))) {
        recordAuthFailure(ctx.req, 'login');
        throw new Error('Invalid email or password');
      }
      const token = await createSessionForUser(user._id);
      ctx.cookieState.setSession = token;
      clearAuthFailures(ctx.req, 'login');
      return { token, user: serializeUser(user) };
    },

    logout: async (_: unknown, __: unknown, ctx: GqlContext) => {
      await destroySession(ctx.req);
      ctx.cookieState.clearSession = true;
      return true;
    },

    createShortLink: async (
      _: unknown,
      args: { targetUrl: string; customSlug?: string | null },
      ctx: GqlContext,
    ) => {
      const u = requireAuth(ctx);
      let targetUrl = args.targetUrl.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = `https://${targetUrl}`;
      }
      try {
        new URL(targetUrl);
      } catch {
        throw new Error('Invalid target URL');
      }

      let slug = args.customSlug ? normalizeSlug(args.customSlug) : '';
      if (slug.length < 2) {
        for (let i = 0; i < 8; i++) {
          slug = randomSlug(7);
          const exists = await Link.exists({ slug });
          if (!exists) break;
        }
      } else {
        const exists = await Link.exists({ slug });
        if (exists) throw new Error('Slug already taken');
      }

      const plan = u.plan ?? 'free';
      const doc = await Link.create({
        slug,
        targetUrl,
        clicks: 0,
        adImpressions: 0,
        plan,
        ownerId: u._id,
      });
      return serializeLink(doc.toObject(), u.email, linkInterstitialAllowedForOwner(u));
    },

    updateMyLink: async (
      _: unknown,
      args: { id: string; targetUrl: string; slug: string },
      ctx: GqlContext,
    ) => {
      const u = requireAuth(ctx);
      const doc = (await Link.findById(args.id).lean()) as any;
      if (!doc || String(doc.ownerId) !== String(u._id)) {
        throw new Error('Link not found');
      }
      let targetUrl = args.targetUrl.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = `https://${targetUrl}`;
      }
      try {
        new URL(targetUrl);
      } catch {
        throw new Error('Invalid target URL');
      }
      const newSlug = normalizeSlug(args.slug);
      if (newSlug.length < 2) {
        throw new Error('Slug must be at least 2 characters');
      }
      if (newSlug !== doc.slug) {
        const taken = await Link.exists({ slug: newSlug, _id: { $ne: doc._id } });
        if (taken) throw new Error('Slug already taken');
      }
      const updated = (await Link.findByIdAndUpdate(
        args.id,
        { targetUrl, slug: newSlug },
        { new: true },
      ).lean()) as any;
      return serializeLink(updated, u.email, linkInterstitialAllowedForOwner(u));
    },

    deleteMyLink: async (_: unknown, args: { id: string }, ctx: GqlContext) => {
      const u = requireAuth(ctx);
      const doc = (await Link.findById(args.id).lean()) as any;
      if (!doc || String(doc.ownerId) !== String(u._id)) {
        throw new Error('Link not found');
      }
      const r = await Link.deleteOne({ _id: args.id });
      return r.deletedCount > 0;
    },

    recordClick: async (_: unknown, args: { slug: string }, ctx: GqlContext) => {
      if (isLikelyBot(clientUa(ctx.req))) {
        await Metric.updateOne({ key: 'click_bot_skips' }, { $inc: { count: 1 } }, { upsert: true });
        return true;
      }
      const slug = args.slug.trim();
      if (!slug) return false;
      const dayUtc = utcDayString();
      const visitorKey = visitorDayFingerprint(ctx.req, dayUtc);
      const refHdr = ctx.req.headers.referer ?? ctx.req.headers.referrer;
      const ref =
        (typeof refHdr === 'string' ? refHdr : Array.isArray(refHdr) ? refHdr[0] : '')?.slice(0, 500) ??
        '';
      const link = (await Link.findOne({ slug }).select('_id').lean()) as any;
      await ClickEvent.create({
        slug,
        linkId: link?._id ?? null,
        at: new Date(),
        visitorKey,
        dayUtc,
        referrer: ref,
      });
      const res = await Link.updateOne({ slug }, { $inc: { clicks: 1 } });
      return res.modifiedCount > 0 || res.matchedCount > 0;
    },

    recordSitePageView: async (_: unknown, args: { path: string }, ctx: GqlContext) => {
      if (isLikelyBot(clientUa(ctx.req))) return false;
      const path = normalizeSitePath(args.path);
      if (!path) return false;
      const dayUtc = utcDayString();
      const visitorKey = visitorDayFingerprint(ctx.req, dayUtc);
      const refHdr = ctx.req.headers.referer ?? ctx.req.headers.referrer;
      const ref =
        (typeof refHdr === 'string' ? refHdr : Array.isArray(refHdr) ? refHdr[0] : '')?.slice(0, 500) ??
        '';
      await SiteVisit.create({
        path,
        at: new Date(),
        visitorKey,
        dayUtc,
        referrer: ref,
      });
      return true;
    },

    recordAdImpression: async (_: unknown, __: unknown, ctx: GqlContext) => {
      if (isLikelyBot(clientUa(ctx.req))) {
        return false;
      }
      await Metric.updateOne({ key: 'ad_impressions' }, { $inc: { count: 1 } }, { upsert: true });
      return true;
    },

    recordLinkGateView: async (_: unknown, args: { slug: string }, ctx: GqlContext) => {
      if (isLikelyBot(clientUa(ctx.req))) return false;
      const s = args.slug.trim();
      if (!s) return false;
      const link = (await Link.findOne({ slug: s }).lean()) as any;
      if (!link) return false;
      if (String(link.plan ?? 'free').toLowerCase() !== 'free') return false;
      await Link.updateOne({ _id: link._id }, { $inc: { adImpressions: 1 } });
      await Metric.updateOne(
        { key: 'shortlink_gate_impressions' },
        { $inc: { count: 1 } },
        { upsert: true },
      );
      return true;
    },

    recordPlacementOutboundClick: async (_: unknown, args: { adId: string }, ctx: GqlContext) => {
      if (isLikelyBot(clientUa(ctx.req))) return false;
      const id = String(args.adId ?? '').trim();
      if (!Types.ObjectId.isValid(id)) return false;
      const exists = await AdPlacement.exists({ _id: id });
      if (!exists) return false;
      await Metric.updateOne({ key: 'ad_outbound_clicks' }, { $inc: { count: 1 } }, { upsert: true });
      return true;
    },

    adminUpdateUserPlan: async (
      _: unknown,
      args: { userId: string; plan: string },
      ctx: GqlContext,
    ) => {
      requireAdmin(ctx);
      const p = args.plan.toLowerCase();
      if (!['free', 'premium', 'business'].includes(p)) throw new Error('Invalid plan');

      const existing = (await User.findById(args.userId).lean()) as any;
      if (!existing) throw new Error('User not found');

      if (p === 'free' && existing.stripeSubscriptionId && process.env['STRIPE_SECRET_KEY']?.trim()) {
        try {
          const stripe = getStripe();
          await stripe.subscriptions.cancel(existing.stripeSubscriptionId);
        } catch (e) {
          console.warn('[stripe] adminUpdateUserPlan cancel subscription', e);
        }
      }

      const update: Record<string, unknown> = { plan: p };
      if (p === 'free') {
        update.stripeSubscriptionId = '';
        update.stripeSubscriptionItemId = '';
        update.stripeSubscriptionStatus = '';
        update.stripePriceId = '';
        update.stripeCurrentPeriodEnd = null;
      }

      const user = (await User.findByIdAndUpdate(args.userId, update, { new: true }).lean()) as any;
      if (!user) throw new Error('User not found');
      return serializeUser(user);
    },

    createBillingCheckoutSession: async (
      _: unknown,
      args: { tier: string },
      ctx: GqlContext,
    ) => {
      const u = requireAuth(ctx);
      const tier = args.tier.toLowerCase().trim();
      if (tier !== 'premium' && tier !== 'business') throw new Error('Invalid tier');

      const doc = (await User.findById(u._id).lean()) as any;
      if (!doc) throw new Error('User not found');

      const stripe = getStripe();
      const origin = billingAppOrigin(ctx.req);

      if (planRank(doc.plan) >= planRank(tier) && isPaidSubscriptionStatus(doc.stripeSubscriptionStatus)) {
        throw new Error('You already have this plan or higher on an active subscription');
      }

      if (doc.plan === 'business' && isPaidSubscriptionStatus(doc.stripeSubscriptionStatus)) {
        throw new Error('You are already on the Business plan with an active subscription');
      }

      if (
        doc.plan === 'premium' &&
        tier === 'premium' &&
        isPaidSubscriptionStatus(doc.stripeSubscriptionStatus)
      ) {
        throw new Error(
          'You already have an active Premium subscription. Use Manage billing to change payment or cancel.',
        );
      }

      if (
        doc.plan === 'premium' &&
        tier === 'business' &&
        isPaidSubscriptionStatus(doc.stripeSubscriptionStatus) &&
        doc.stripeSubscriptionId
      ) {
        throw new Error('Use “Upgrade to Business” to change your existing subscription.');
      }

      let customerId = String(doc.stripeCustomerId ?? '').trim();
      if (!customerId) {
        const c = await stripe.customers.create({
          email: doc.email,
          metadata: { userId: String(doc._id) },
        });
        customerId = c.id;
        await User.updateOne({ _id: doc._id }, { stripeCustomerId: customerId });
      }

      const priceId = tier === 'business' ? getBusinessPriceId() : getPremiumPriceId();

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: String(doc._id),
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/dashboard?billing=success`,
        cancel_url: `${origin}/dashboard?billing=cancel`,
        metadata: { userId: String(doc._id), tier },
        subscription_data: {
          metadata: { userId: String(doc._id), tier },
        },
      });
      const url = session.url;
      if (!url) throw new Error('Checkout session missing URL');
      return url;
    },

    createBillingPortalSession: async (_: unknown, __: unknown, ctx: GqlContext) => {
      const u = requireAuth(ctx);
      const doc = (await User.findById(u._id).lean()) as any;
      if (!doc) throw new Error('User not found');
      const customerId = String(doc.stripeCustomerId ?? '').trim();
      if (!customerId) throw new Error('No billing account on file');

      const stripe = getStripe();
      const origin = billingAppOrigin(ctx.req);
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/dashboard`,
      });
      const url = session.url;
      if (!url) throw new Error('Portal session missing URL');
      return url;
    },

    upgradeBillingSubscriptionToBusiness: async (_: unknown, __: unknown, ctx: GqlContext) => {
      const u = requireAuth(ctx);
      const doc = (await User.findById(u._id).lean()) as any;
      if (!doc) throw new Error('User not found');
      if (String(doc.plan ?? '').toLowerCase() !== 'premium') {
        throw new Error('Premium plan required to upgrade in-place');
      }
      const subId = String(doc.stripeSubscriptionId ?? '').trim();
      const itemId = String(doc.stripeSubscriptionItemId ?? '').trim();
      if (!subId || !itemId || !isPaidSubscriptionStatus(doc.stripeSubscriptionStatus)) {
        throw new Error('No active Premium subscription to upgrade');
      }

      const stripe = getStripe();
      const businessPrice = getBusinessPriceId();
      await stripe.subscriptions.update(subId, {
        items: [{ id: itemId, price: businessPrice }],
        proration_behavior: 'create_prorations',
        metadata: { userId: String(doc._id), tier: 'business' },
      });
      const sub = await stripe.subscriptions.retrieve(subId);
      await applySubscriptionState(sub);
      return true;
    },

    updateMyShortLinkAdsPreference: async (
      _: unknown,
      args: { enabled: boolean },
      ctx: GqlContext,
    ) => {
      const u = requireAuth(ctx);
      const doc = (await User.findById(u._id).lean()) as any;
      if (!doc) throw new Error('User not found');
      const p = String(doc.plan ?? 'free').toLowerCase();
      if (p !== 'premium' && p !== 'business') {
        throw new Error('Premium or Business plan required to change short link ads');
      }
      await User.updateOne({ _id: u._id }, { shortLinkAdsEnabled: args.enabled });
      const fresh = (await User.findById(u._id).lean()) as any;
      return serializeUser(fresh);
    },

    adminUpsertAd: async (_: unknown, args: { input: Record<string, unknown> }, ctx: GqlContext) => {
      requireAdmin(ctx);
      const i = args.input;
      const title = String(i['title'] ?? '');
      const targetUrl = String(i['targetUrl'] ?? '');
      if (!title || !targetUrl) throw new Error('title and targetUrl required');
      const id = i['id'] != null ? String(i['id']) : '';
      const body = {
        title,
        body: String(i['body'] ?? ''),
        targetUrl,
        imageUrl: String(i['imageUrl'] ?? ''),
        regions: String(i['regions'] ?? '*'),
        priority: Number(i['priority'] ?? 0),
        active: i['active'] !== false,
        audiencePlan: ['all', 'free'].includes(String(i['audiencePlan'] ?? 'free').toLowerCase())
          ? String(i['audiencePlan']).toLowerCase()
          : 'free',
      };
      if (id) {
        const doc = (await AdPlacement.findByIdAndUpdate(id, body, { new: true }).lean()) as any;
        if (!doc) throw new Error('Ad not found');
        return serializeAd(doc);
      }
      const doc = await AdPlacement.create(body);
      return serializeAd(doc.toObject());
    },

    adminDeleteAd: async (_: unknown, args: { id: string }, ctx: GqlContext) => {
      requireAdmin(ctx);
      const r = await AdPlacement.deleteOne({ _id: args.id });
      return r.deletedCount > 0;
    },
  },
};

function serializeLink(
  doc: {
    _id: unknown;
    slug: string;
    targetUrl: string;
    clicks?: number;
    adImpressions?: number;
    plan?: string;
    ownerId?: unknown;
    createdAt?: Date;
  },
  ownerEmail: string | null,
  linkInterstitialAllowed = true,
) {
  return {
    id: String(doc._id),
    slug: doc.slug,
    targetUrl: doc.targetUrl,
    clicks: doc.clicks ?? 0,
    adImpressions: doc.adImpressions ?? 0,
    plan: doc.plan ?? 'free',
    ownerId: doc.ownerId ? String(doc.ownerId) : null,
    ownerEmail,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    linkInterstitialAllowed,
  };
}

function serializeAd(doc: {
  _id: unknown;
  title: string;
  body?: string;
  targetUrl: string;
  imageUrl?: string;
  regions?: string;
  priority?: number;
  active?: boolean;
  audiencePlan?: string;
  createdAt?: Date;
}) {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body ?? '',
    targetUrl: doc.targetUrl,
    imageUrl: doc.imageUrl ?? '',
    regions: doc.regions ?? '*',
    priority: doc.priority ?? 0,
    active: doc.active !== false,
    audiencePlan: doc.audiencePlan ?? 'free',
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
  };
}
