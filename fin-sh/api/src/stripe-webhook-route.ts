import type { Request, Response } from 'express';
import { getStripe, getWebhookSecret } from './stripe-billing.js';
import { applySubscriptionState, handleCheckoutSessionCompleted } from './stripe-sync.js';

/**
 * Stripe webhook — must receive raw body. Mount before `express.json()`.
 */
export async function stripeWebhookRoute(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string') {
    res.status(400).send('Missing stripe-signature');
    return;
  }
  let event: import('stripe').Stripe.Event;
  try {
    const stripe = getStripe();
    const raw = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
    event = stripe.webhooks.constructEvent(raw, sig, getWebhookSecret());
  } catch (err) {
    console.error('[stripe] webhook signature', err);
    res.status(400).send('Invalid signature');
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as import('stripe').Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscriptionState(event.data.object as import('stripe').Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe] webhook handler', event.type, e);
    res.status(500).json({ received: false });
    return;
  }

  res.json({ received: true });
}
