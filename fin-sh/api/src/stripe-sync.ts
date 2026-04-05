import type Stripe from 'stripe';
import { Types } from 'mongoose';
import { User } from './models.js';
import { getStripe, tierFromPriceId } from './stripe-billing.js';

function customerIdOf(sub: Stripe.Subscription): string {
  const c = sub.customer;
  return typeof c === 'string' ? c : c.id;
}

/**
 * Persist subscription state from Stripe webhooks / post-checkout.
 * Plan is derived from the first line item’s price id.
 */
export async function applySubscriptionState(sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub);
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? '';
  const tier = tierFromPriceId(priceId);
  const userIdMeta = sub.metadata?.['userId']?.trim();

  let user: { _id: unknown } | null = null;
  if (userIdMeta && Types.ObjectId.isValid(userIdMeta)) {
    user = (await User.findById(userIdMeta).select('_id').lean()) as { _id: unknown } | null;
  }
  if (!user) {
    user = (await User.findOne({ stripeCustomerId: customerId }).select('_id').lean()) as {
      _id: unknown;
    } | null;
  }
  if (!user) {
    console.warn('[stripe] applySubscriptionState: no user for sub', sub.id, customerId);
    return;
  }

  const status = sub.status;
  const itemId = item?.id ?? '';

  if (status === 'incomplete') {
    return;
  }

  const periodEnd =
    typeof sub.current_period_end === 'number' ? new Date(sub.current_period_end * 1000) : null;

  if (status === 'active' || status === 'trialing') {
    if (tier) {
      await User.updateOne(
        { _id: user._id },
        {
          plan: tier,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          stripeSubscriptionItemId: itemId,
          stripeSubscriptionStatus: status,
          stripePriceId: priceId,
          stripeCurrentPeriodEnd: periodEnd,
        },
      );
    }
    return;
  }

  if (status === 'past_due' && tier) {
    await User.updateOne(
      { _id: user._id },
      {
        plan: tier,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        stripeSubscriptionItemId: itemId,
        stripeSubscriptionStatus: status,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: periodEnd,
      },
    );
    return;
  }

  if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
    await User.updateOne(
      { _id: user._id },
      {
        plan: 'free',
        stripeSubscriptionId: '',
        stripeSubscriptionItemId: '',
        stripeSubscriptionStatus: status,
        stripePriceId: '',
        stripeCurrentPeriodEnd: null,
      },
    );
  }
}

export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'subscription') return;
  const subId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subId) return;
  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    await applySubscriptionState(sub);
  } catch (e) {
    console.error('[stripe] checkout.session.completed', e);
  }
}
