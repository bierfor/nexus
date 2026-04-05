import type { IncomingMessage } from 'node:http';
import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY']?.trim();
  if (!key) throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY)');
  if (!stripeSingleton) stripeSingleton = new Stripe(key);
  return stripeSingleton;
}

export function getPremiumPriceId(): string {
  const id = process.env['STRIPE_PRICE_PREMIUM']?.trim();
  if (!id) throw new Error('Missing STRIPE_PRICE_PREMIUM');
  return id;
}

export function getBusinessPriceId(): string {
  const id = process.env['STRIPE_PRICE_BUSINESS']?.trim();
  if (!id) throw new Error('Missing STRIPE_PRICE_BUSINESS');
  return id;
}

export function getWebhookSecret(): string {
  const s = process.env['STRIPE_WEBHOOK_SECRET']?.trim();
  if (!s) throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  return s;
}

export function planRank(plan: string): number {
  const p = plan.toLowerCase();
  if (p === 'business') return 2;
  if (p === 'premium') return 1;
  return 0;
}

export function tierFromPriceId(priceId: string): 'premium' | 'business' | null {
  const premium = process.env['STRIPE_PRICE_PREMIUM']?.trim();
  const business = process.env['STRIPE_PRICE_BUSINESS']?.trim();
  if (priceId && premium && priceId === premium) return 'premium';
  if (priceId && business && priceId === business) return 'business';
  return null;
}

export function isPaidSubscriptionStatus(status: string | undefined): boolean {
  if (!status) return false;
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

/** Success/cancel URLs for Checkout / Portal — must be the Nexus app origin users see in the browser. */
export function billingAppOrigin(req: IncomingMessage): string {
  const env = process.env['FIN_SH_PUBLIC_ORIGIN']?.trim().replace(/\/$/, '');
  if (env) return env;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('FIN_SH_PUBLIC_ORIGIN is required for Stripe billing in production');
  }
  const host = req.headers.host ?? '';
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `http://${host.replace(/^localhost/, '127.0.0.1')}`;
  }
  return 'http://127.0.0.1:3050';
}
