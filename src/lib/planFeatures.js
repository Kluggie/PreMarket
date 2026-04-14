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

export const PLAN_FEATURES = {
  starter: [
    { text: '5 opportunities per month',     detail: 'Starter monthly allowance' },
    { text: '2 active opportunities at once', detail: 'Manage up to 2 open opportunities simultaneously' },
    { text: '10 AI evaluations per month',   detail: 'AI evaluation monthly allowance' },
    { text: 'Standard AI evaluation report', detail: 'Full evaluation with scoring and insights' },
    { text: 'Organization profiles',         detail: 'Create and manage organization profiles' },
  ],
  professional: [
    { text: 'Unlimited opportunities',        detail: 'No monthly creation limit' },
    { text: 'Unlimited active opportunities', detail: 'No cap on simultaneous open opportunities' },
    { text: 'Unlimited AI evaluations',       detail: 'Run evaluations as often as needed' },
    { text: 'Private mode',                   detail: 'Keep opportunities fully confidential until you choose to share' },
    { text: 'Priority support',               detail: 'Faster support turnaround' },
    { text: 'Organization profiles',          detail: 'Create and manage organization profiles' },
  ],
  enterprise: [
    { text: 'Unlimited opportunities',             detail: 'No monthly creation limit' },
    { text: 'Unlimited active opportunities',      detail: 'No cap on simultaneous open opportunities' },
    { text: 'Unlimited AI evaluations',            detail: 'Run evaluations as often as needed' },
    { text: 'Private mode',                        detail: 'Keep opportunities fully confidential until you choose to share' },
    { text: 'Priority support',                    detail: 'Dedicated support channel' },
    { text: 'Organization profiles',               detail: 'Create and manage organization profiles' },
    { text: 'Custom security review + onboarding', detail: 'Tailored setup and compliance review' },
    { text: 'Advanced data analytics',             detail: 'Deeper reporting and workflow insights' },
  ],
};

// Early-access (trial) users get the same feature set as Professional.
PLAN_FEATURES.early_access = PLAN_FEATURES.professional;
