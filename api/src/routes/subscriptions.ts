import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { checkoutLimiter } from '../middleware/rateLimit';
import { Subscription, User } from '../models';

// Helper to get userId from request
const getUserId = (req: Request): string => (req as any).userId!;
import { getPublicPlans, PLANS, FEATURE_COMPARISON, getPlanById } from '../data/plans';
import {
  createCheckoutSession,
  createBillingPortalSession,
  cancelSubscription,
  reactivateSubscription,
} from '../services/stripe';

const router = Router();

// Get all pricing plans (public)
router.get('/plans', (req: Request, res: Response) => {
  res.json({
    plans: getPublicPlans(),
    featureComparison: FEATURE_COMPARISON,
  });
});

// Get a specific plan (public)
router.get('/plans/:planId', (req: Request, res: Response) => {
  const { planId } = req.params;
  const plan = getPlanById(planId);

  if (!plan) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Plan not found',
    });
  }

  // Remove Stripe price ID from response
  const { stripePriceId, ...publicPlan } = plan;
  res.json({ plan: publicPlan });
});

// Get current user's subscription
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);

    const subscription = await Subscription.findOne({
      where: { userId },
    });

    if (!subscription) {
      // Return default personal subscription
      return res.json({
        subscription: {
          plan: 'personal',
          status: 'active',
          seatCount: 1,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
      });
    }

    res.json({
      subscription: {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        seatCount: subscription.seatCount,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create checkout session for upgrading
router.post('/checkout', authMiddleware, checkoutLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { planId, teamId, seatCount, successUrl, cancelUrl } = req.body;

    if (!planId || !['pro', 'enterprise'].includes(planId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid plan. Must be "pro" or "enterprise".',
      });
    }

    const checkoutUrl = await createCheckoutSession({
      userId,
      planId,
      teamId,
      seatCount: seatCount || 1,
      successUrl,
      cancelUrl,
    });

    res.json({ url: checkoutUrl });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Failed to create checkout session',
    });
  }
});

// Create billing portal session
router.post('/portal', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { returnUrl } = req.body;

    const portalUrl = await createBillingPortalSession({
      userId,
      returnUrl,
    });

    res.json({ url: portalUrl });
  } catch (error) {
    console.error('Create portal error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Failed to create billing portal session',
    });
  }
});

// Cancel subscription (at period end)
router.post('/cancel', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);

    await cancelSubscription(userId);

    res.json({
      message: 'Subscription will be canceled at the end of the billing period',
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Failed to cancel subscription',
    });
  }
});

// Reactivate canceled subscription
router.post('/reactivate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);

    await reactivateSubscription(userId);

    res.json({
      message: 'Subscription reactivated successfully',
    });
  } catch (error) {
    console.error('Reactivate subscription error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Failed to reactivate subscription',
    });
  }
});

export default router;

