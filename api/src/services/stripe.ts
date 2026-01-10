import Stripe from 'stripe';
import { User, Subscription, Team } from '../models';
import { getPlanById } from '../data/plans';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export interface CreateCheckoutSessionParams {
  userId: string;
  planId: 'pro' | 'enterprise';
  teamId?: string;
  seatCount?: number;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateBillingPortalParams {
  userId: string;
  returnUrl?: string;
}

// Create or get Stripe customer
export const getOrCreateStripeCustomer = async (user: User): Promise<string> => {
  // Check if user already has a subscription with a Stripe customer ID
  const subscription = await Subscription.findOne({
    where: { userId: user.id },
  });

  if (subscription?.stripeCustomerId) {
    return subscription.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: {
      userId: user.id,
    },
  });

  return customer.id;
};

// Create checkout session for subscription
export const createCheckoutSession = async (params: CreateCheckoutSessionParams): Promise<string> => {
  const { userId, planId, teamId, seatCount = 1, successUrl, cancelUrl } = params;

  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const plan = getPlanById(planId);
  if (!plan || !plan.stripePriceId) {
    throw new Error('Invalid plan or plan has no Stripe price');
  }

  const customerId = await getOrCreateStripeCustomer(user);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: plan.stripePriceId,
        quantity: seatCount,
      },
    ],
    success_url: successUrl || `${FRONTEND_URL}/settings?tab=subscription&success=true`,
    cancel_url: cancelUrl || `${FRONTEND_URL}/settings?tab=subscription&canceled=true`,
    metadata: {
      userId,
      planId,
      teamId: teamId || '',
      seatCount: seatCount.toString(),
    },
    subscription_data: {
      metadata: {
        userId,
        planId,
        teamId: teamId || '',
      },
    },
    allow_promotion_codes: true,
  });

  return session.url || '';
};

// Create billing portal session
export const createBillingPortalSession = async (params: CreateBillingPortalParams): Promise<string> => {
  const { userId, returnUrl } = params;

  const subscription = await Subscription.findOne({
    where: { userId },
  });

  if (!subscription?.stripeCustomerId) {
    throw new Error('No Stripe customer found for this user');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: returnUrl || `${FRONTEND_URL}/settings?tab=subscription`,
  });

  return session.url;
};

// Handle Stripe webhook events
export const handleWebhookEvent = async (event: Stripe.Event): Promise<void> => {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutComplete(session);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdate(subscription);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(subscription);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentFailed(invoice);
      break;
    }
    default:
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }
};

// Handle successful checkout
const handleCheckoutComplete = async (session: Stripe.Checkout.Session): Promise<void> => {
  const { userId, planId, teamId, seatCount } = session.metadata || {};
  
  if (!userId || !planId) {
    console.error('Missing metadata in checkout session');
    return;
  }

  // Find or create subscription
  let subscription = await Subscription.findOne({
    where: teamId ? { teamId } : { userId },
  });

  if (subscription) {
    await subscription.update({
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
      plan: planId as 'pro' | 'enterprise',
      status: 'active',
      seatCount: parseInt(seatCount || '1', 10),
    });
  } else {
    await Subscription.create({
      userId: teamId ? null : userId,
      teamId: teamId || null,
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
      plan: planId as 'pro' | 'enterprise',
      status: 'active',
      seatCount: parseInt(seatCount || '1', 10),
    });
  }

  console.log(`Checkout completed for user ${userId}, plan ${planId}`);
};

// Handle subscription updates
const handleSubscriptionUpdate = async (stripeSubscription: Stripe.Subscription): Promise<void> => {
  const { userId, planId } = stripeSubscription.metadata || {};

  const subscription = await Subscription.findOne({
    where: { stripeSubscriptionId: stripeSubscription.id },
  });

  if (!subscription) {
    console.error(`Subscription not found for Stripe subscription ${stripeSubscription.id}`);
    return;
  }

  // Map Stripe status to our status
  let status: 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing' = 'active';
  switch (stripeSubscription.status) {
    case 'active':
      status = 'active';
      break;
    case 'canceled':
      status = 'canceled';
      break;
    case 'past_due':
      status = 'past_due';
      break;
    case 'incomplete':
    case 'incomplete_expired':
      status = 'incomplete';
      break;
    case 'trialing':
      status = 'trialing';
      break;
  }

  await subscription.update({
    status,
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    seatCount: stripeSubscription.items.data[0]?.quantity || 1,
  });

  console.log(`Subscription ${subscription.id} updated to status ${status}`);
};

// Handle subscription deletion
const handleSubscriptionDeleted = async (stripeSubscription: Stripe.Subscription): Promise<void> => {
  const subscription = await Subscription.findOne({
    where: { stripeSubscriptionId: stripeSubscription.id },
  });

  if (!subscription) {
    console.error(`Subscription not found for Stripe subscription ${stripeSubscription.id}`);
    return;
  }

  // Downgrade to personal plan
  await subscription.update({
    plan: 'personal',
    status: 'active',
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    seatCount: 1,
  });

  console.log(`Subscription ${subscription.id} downgraded to personal plan`);
};

// Handle failed payment
const handlePaymentFailed = async (invoice: Stripe.Invoice): Promise<void> => {
  const customerId = invoice.customer as string;
  
  const subscription = await Subscription.findOne({
    where: { stripeCustomerId: customerId },
  });

  if (subscription) {
    await subscription.update({ status: 'past_due' });
    console.log(`Subscription ${subscription.id} marked as past_due due to payment failure`);
  }
};

// Update seat count for a subscription
export const updateSeatCount = async (subscriptionId: string, newSeatCount: number): Promise<void> => {
  const subscription = await Subscription.findByPk(subscriptionId);
  
  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No active Stripe subscription found');
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  const itemId = stripeSubscription.items.data[0]?.id;

  if (!itemId) {
    throw new Error('No subscription item found');
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [
      {
        id: itemId,
        quantity: newSeatCount,
      },
    ],
    proration_behavior: 'create_prorations',
  });

  await subscription.update({ seatCount: newSeatCount });
};

// Cancel subscription at period end
export const cancelSubscription = async (userId: string): Promise<void> => {
  const subscription = await Subscription.findOne({
    where: { userId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No active Stripe subscription found');
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await subscription.update({ cancelAtPeriodEnd: true });
};

// Reactivate canceled subscription
export const reactivateSubscription = async (userId: string): Promise<void> => {
  const subscription = await Subscription.findOne({
    where: { userId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No active Stripe subscription found');
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  await subscription.update({ cancelAtPeriodEnd: false });
};

export { stripe };

