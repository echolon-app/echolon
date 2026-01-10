export interface PlanFeature {
  text: string;
  included: boolean;
}

export interface Plan {
  id: 'personal' | 'pro' | 'enterprise';
  name: string;
  price: number;
  period: string;
  billing?: string;
  description: string;
  features: string[];
  cta: string;
  ctaLink: string;
  highlight: boolean;
  badge: string | null;
  stripePriceId?: string;
  maxTeamSize?: number;
}

// Single source of truth for all pricing data
export const PLANS: Plan[] = [
  {
    id: 'personal',
    name: 'Personal',
    price: 0,
    period: 'forever',
    description: 'Free non-commercial, personal use',
    features: [
      'Unlimited workspaces',
      'Unlimited collections',
      'Unlimited requests',
      'Unlimited variables',
      'Scripting support',
      'Full Git Sync support',
      'Mocking servers (local and cloud)',
      'Auto Watch and Migration for remote API changes',
      'Import from OpenAPI, Postman, cURL etc.',
      'REST, GraphQL and WebSocket support',
      'Request History',
      'Web/Mac/Windows/Linux Versions',
      'All Auth types',
      'Community Support',
    ],
    cta: 'Download Free',
    ctaLink: '/download',
    highlight: false,
    badge: null,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 9,
    period: 'per user / month',
    billing: 'billed yearly',
    description: 'For professional developers and small teams.',
    features: [
      'Everything in Personal',
      'Commercial use',
      'Support the development of Echolon',
      'User management',
      '1-Click publish of your APIs',
      'Priority support (via email)',
    ],
    cta: 'Upgrade to Pro',
    ctaLink: 'mailto:support@echolon.app?subject=Echolon%20Pro&body=Company%3A%20%0ANumber%20of%20licenses%3A%20%0ABilling%20Address%3A%20%0ANotes%3A%20',
    highlight: true,
    badge: 'Most Popular',
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID,
    maxTeamSize: 10,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 19,
    period: 'per user / month',
    billing: 'billed yearly',
    description: 'For organizations that need enterprise features.',
    features: [
      'Everything in Pro',
      'Influence on the feature roadmap',
      'Priority support (via email, chat or video)',
      'SSO / SAML authentication (coming soon)',
      'Integration with Secret Managers (coming soon)',
      'Dedicated account manager',
    ],
    cta: 'Contact Sales',
    ctaLink: 'mailto:support@echolon.app?subject=Echolon%20Enterprise&body=Company%3A%20%0ANumber%20of%20licenses%3A%20%0ABilling%20Address%3A%20%0ANotes%3A%20',
    highlight: false,
    badge: 'Enterprise',
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    maxTeamSize: undefined, // Unlimited
  },
];

// Helper function to get a specific plan
export const getPlanById = (id: string): Plan | undefined => {
  return PLANS.find(plan => plan.id === id);
};

// Helper function to get plans safe for client (without Stripe price IDs)
export const getPublicPlans = (): Omit<Plan, 'stripePriceId'>[] => {
  return PLANS.map(({ stripePriceId, ...plan }) => plan);
};

// Feature comparison data for landing page
export const FEATURE_COMPARISON = {
  categories: [
    {
      name: 'Core Features',
      features: [
        { name: 'Unlimited workspaces', personal: true, pro: true, enterprise: true },
        { name: 'Unlimited collections', personal: true, pro: true, enterprise: true },
        { name: 'Unlimited requests', personal: true, pro: true, enterprise: true },
        { name: 'REST API support', personal: true, pro: true, enterprise: true },
        { name: 'GraphQL support', personal: true, pro: true, enterprise: true },
        { name: 'WebSocket support', personal: true, pro: true, enterprise: true },
        { name: 'gRPC support', personal: true, pro: true, enterprise: true },
      ],
    },
    {
      name: 'Collaboration',
      features: [
        { name: 'Git sync', personal: true, pro: true, enterprise: true },
        { name: 'Team workspaces', personal: false, pro: true, enterprise: true },
        { name: 'User management', personal: false, pro: true, enterprise: true },
        { name: 'Role-based access', personal: false, pro: true, enterprise: true },
        { name: 'Unlimited team members', personal: false, pro: false, enterprise: true },
      ],
    },
    {
      name: 'Advanced Features',
      features: [
        { name: 'API mocking', personal: true, pro: true, enterprise: true },
        { name: 'Advanced mock servers', personal: false, pro: true, enterprise: true },
        { name: 'API publishing', personal: false, pro: true, enterprise: true },
        { name: 'Audit logs', personal: false, pro: false, enterprise: true },
        { name: 'SSO / SAML', personal: false, pro: false, enterprise: true },
        { name: 'Secret manager integration', personal: false, pro: false, enterprise: true },
      ],
    },
    {
      name: 'Support',
      features: [
        { name: 'Community support', personal: true, pro: true, enterprise: true },
        { name: 'Email support', personal: false, pro: true, enterprise: true },
        { name: 'Priority support', personal: false, pro: true, enterprise: true },
        { name: 'Video call support', personal: false, pro: false, enterprise: true },
        { name: 'Dedicated account manager', personal: false, pro: false, enterprise: true },
        { name: 'SLA guarantee', personal: false, pro: false, enterprise: true },
      ],
    },
  ],
};

