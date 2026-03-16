/**
 * Client-side Private Mode entitlement helper.
 *
 * Keep this in sync with server/_lib/private-mode.ts eligibility semantics.
 */

const PRIVATE_MODE_ELIGIBLE_PLANS = new Set([
  'early_access',
  'early-access',
  'early access',
  'early_access_program',
  'early-access-program',
  'early access program',
  'professional',
  'enterprise',
]);

export const PRIVATE_MODE_ELIGIBILITY_COPY = 'Available on Early Access, Professional, and Enterprise plans';

export function isPrivateModePlanEligible(planTier) {
  return PRIVATE_MODE_ELIGIBLE_PLANS.has(String(planTier || '').trim().toLowerCase());
}
