/**
 * Canonical plan feature definitions.
 *
 * Single source of truth consumed by Pricing.jsx and Billing.jsx.
 * Each entry has:
 *   text   — the user-facing feature label
 *   detail — a brief supporting description (used on the Billing page)
 *
 * When adding or changing features, update this file only.
 */

export const PLAN_LIMITS = Object.freeze({
  starter: Object.freeze({
    opportunitiesPerMonth: 1,
    activeOpportunities: 1,
    aiEvaluationsPerMonth: 3,
  }),
  professional: Object.freeze({
    opportunitiesPerMonth: Infinity,
    activeOpportunities: Infinity,
    aiEvaluationsPerMonth: 20,
  }),
  team: Object.freeze({
    opportunitiesPerMonth: Infinity,
    activeOpportunities: Infinity,
    aiEvaluationsPerMonth: 100,
    includedUsers: '3-5',
  }),
  enterprise: Object.freeze({
    opportunitiesPerMonth: 'custom',
    activeOpportunities: 'custom',
    aiEvaluationsPerMonth: 'custom',
  }),
});

export const PLAN_FEATURES = {
  starter: [
    { text: '1 opportunity per month',                 detail: 'Starter monthly opportunity allowance' },
    { text: '1 active opportunity at once',             detail: 'Manage one open opportunity at a time' },
    { text: '3 AI mediation reviews per month',         detail: 'Monthly review-credit allowance' },
    { text: 'Standard AI mediation report',             detail: 'Structured review with scoring and insights' },
    { text: 'Invited counterparties participate for free', detail: 'Recipients can view, review, and respond without a paid plan' },
    { text: 'Upgrade required for more review capacity', detail: 'Move to Professional when you need more monthly reviews' },
  ],
  professional: [
    { text: 'Unlimited opportunities',           detail: 'No monthly creation limit' },
    { text: 'Unlimited active opportunities',    detail: 'No cap on simultaneous open opportunities' },
    { text: '20 AI mediation reviews per month', detail: 'Monthly review-credit allowance' },
    { text: 'Step 2 suggestion tools',           detail: 'Drafting and refinement assistance before mediation review' },
    { text: 'Shared reports',                    detail: 'Share recipient-safe reports with counterparties' },
    { text: 'Invite counterparties for free',     detail: 'Recipients can participate without a paid plan' },
    { text: 'Private mode',                      detail: 'Keep opportunities fully confidential until you choose to share' },
    { text: 'Priority support',                  detail: 'Faster support turnaround' },
    { text: 'Organization profiles',             detail: 'Create and manage organization profiles' },
    { text: 'Additional review credits on request', detail: 'Contact us when you need more monthly review capacity' },
  ],
  team: [
    { text: 'Team setup for 3-5 users',          detail: 'Provisioned team access for a small workspace' },
    { text: 'Unlimited opportunities',           detail: 'No monthly creation limit' },
    { text: 'Unlimited active opportunities',    detail: 'No cap on simultaneous open opportunities' },
    { text: '100 AI mediation reviews/month for the team account', detail: 'Monthly review-credit allowance configured during setup' },
    { text: 'Shared workspace setup',            detail: 'Contact us to configure team access' },
    { text: 'Shared reports',                    detail: 'Share recipient-safe reports with counterparties' },
    { text: 'Invite counterparties for free',     detail: 'Recipients can participate without a paid plan' },
    { text: 'Private mode',                      detail: 'Keep opportunities fully confidential until you choose to share' },
    { text: 'Priority support',                  detail: 'Faster support turnaround' },
    { text: 'Organization profiles',             detail: 'Create and manage organization profiles' },
    { text: 'Discounted extra review credits',   detail: 'Contact us for additional review volume' },
  ],
  enterprise: [
    { text: 'Custom AI mediation review volume',   detail: 'Negotiated monthly review capacity' },
    { text: 'Custom review pricing',               detail: 'Commercial terms matched to expected review volume' },
    { text: 'Free counterparty participation',     detail: 'Recipients can participate without a paid plan' },
    { text: 'Custom security review + onboarding', detail: 'Tailored setup and compliance review' },
    { text: 'Advanced data analytics',             detail: 'Deeper reporting and workflow insights' },
    { text: 'Priority support',                    detail: 'Dedicated support channel' },
    { text: 'Custom contract terms',               detail: 'Annual contract or invoicing where appropriate' },
    { text: 'Contact Sales',                       detail: 'Talk to us about the right enterprise setup' },
  ],
};

// Early-access (trial) users get the same feature set as Professional.
PLAN_FEATURES.early_access = PLAN_FEATURES.professional;
PLAN_FEATURES.early_access_program = PLAN_FEATURES.professional;
