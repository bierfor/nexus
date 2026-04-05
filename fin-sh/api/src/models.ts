import mongoose, { Schema, type Model } from 'mongoose';

function modelFor(name: string, schema: Schema): Model<any> {
  const existing = mongoose.models[name] as Model<any> | undefined;
  if (existing) return existing;
  return mongoose.model(name, schema);
}

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '' },
    plan: {
      type: String,
      enum: ['free', 'premium', 'business'],
      default: 'free',
      index: true,
    },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    /** Stripe Customer id (cus_…). */
    stripeCustomerId: { type: String, default: '', index: true },
    /** Active subscription id (sub_…), if any. */
    stripeSubscriptionId: { type: String, default: '' },
    /** First subscription item id — used for plan upgrades. */
    stripeSubscriptionItemId: { type: String, default: '' },
    /** Stripe subscription.status mirror (active, trialing, past_due, canceled, …). */
    stripeSubscriptionStatus: { type: String, default: '' },
    /** Active Stripe Price id for the subscription line item. */
    stripePriceId: { type: String, default: '' },
    /** End of current paid period (from Stripe subscription). */
    stripeCurrentPeriodEnd: { type: Date, default: null },
    /**
     * Premium/Business only: when true (default), visitors may see the sponsored interstitial on links
     * that still carry plan snapshot `free`. Free accounts cannot turn this off.
     */
    shortLinkAdsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const sessionSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

const linkSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    targetUrl: { type: String, required: true },
    clicks: { type: Number, default: 0 },
    adImpressions: { type: Number, default: 0 },
    /** Snapshot of owner plan when link was created (analytics / reporting). */
    plan: { type: String, enum: ['free', 'premium', 'business'], default: 'free' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  },
  { timestamps: true },
);

const metricSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
});

/** One row per short-link redirect (bots excluded at ingest). Used for uniques + funnels. */
const clickEventSchema = new Schema(
  {
    slug: { type: String, required: true, index: true },
    linkId: { type: Schema.Types.ObjectId, ref: 'Link', default: null, index: true },
    at: { type: Date, required: true, index: true },
    visitorKey: { type: String, required: true, index: true },
    dayUtc: { type: String, required: true, index: true },
    referrer: { type: String, default: '' },
  },
  { timestamps: false },
);
clickEventSchema.index({ slug: 1, at: -1 });
clickEventSchema.index({ dayUtc: 1, visitorKey: 1 });
/** Auto-purge raw events after ~120 days (TTL). Aggregates on Link document remain. */
clickEventSchema.index({ at: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 });

/** Marketing site page views (session-deduped client-side). */
const siteVisitSchema = new Schema(
  {
    path: { type: String, required: true, index: true },
    at: { type: Date, required: true, index: true },
    visitorKey: { type: String, required: true, index: true },
    dayUtc: { type: String, required: true, index: true },
    referrer: { type: String, default: '' },
  },
  { timestamps: false },
);
siteVisitSchema.index({ path: 1, at: -1 });
siteVisitSchema.index({ dayUtc: 1, visitorKey: 1 });
siteVisitSchema.index({ at: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 });

/** Programmatic ads shown to free-plan visitors (admin-managed). */
const adPlacementSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    targetUrl: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    /** Comma-separated region codes or * for all (e.g. "US,CA,*"). */
    regions: { type: String, default: '*' },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    /** free = only free users see; all = any logged visitor (rare). */
    audiencePlan: { type: String, enum: ['free', 'all'], default: 'free' },
  },
  { timestamps: true },
);

export const User = modelFor('User', userSchema);
export const Session = modelFor('Session', sessionSchema);
export const Link = modelFor('Link', linkSchema);
export const Metric = modelFor('Metric', metricSchema);
export const AdPlacement = modelFor('AdPlacement', adPlacementSchema);
export const ClickEvent = modelFor('ClickEvent', clickEventSchema);
export const SiteVisit = modelFor('SiteVisit', siteVisitSchema);
