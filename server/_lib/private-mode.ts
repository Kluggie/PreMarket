/**
 * Private Mode helpers.
 *
 * Private Mode lets a sender on an eligible paid plan create an opportunity
 * where their identity is hidden from the recipient in recipient-facing
 * surfaces and outbound emails.
 *
 * This module is deliberately narrow: it stores constants, the plan-eligibility
 * guard, and a masking helper. It does NOT contain DB queries or route logic.
 */

/** Display label used wherever sender identity is hidden from a recipient. */
export const PRIVATE_SENDER_LABEL = 'Private sender';

/** Org-context variant (share output, report header, etc.). */
export const PRIVATE_ORG_LABEL = 'Private organization';

/**
 * Generic from-line used in outbound emails sent for private opportunities.
 * "A PreMarket user" is intentionally vague.
 */
export const PRIVATE_EMAIL_SENDER_LABEL = 'A PreMarket user';

/**
 * Plan tiers that may enable Private Mode.
 *
 * We accept common normalized and legacy spellings for Early Access to keep
 * entitlement checks resilient to billing-label variations.
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

/**
 * Returns true when the user's current plan tier allows Private Mode.
 *
 * @param planTier   raw value from billing_references.plan (e.g. "professional")
 */
export function isPlanEligibleForPrivateMode(planTier: unknown): boolean {
  return PRIVATE_MODE_ELIGIBLE_PLANS.has(
    String(planTier || '').trim().toLowerCase(),
  );
}

/**
 * Returns true when private-mode masking should be applied for the current
 * viewer. Masking occurs only when ALL three conditions hold:
 *   1. The proposal has is_private_mode = true
 *   2. The viewer is the recipient (party_b)
 *   3. The viewer is NOT the owner
 *
 * @param isPrivateMode  proposal.isPrivateMode flag
 * @param actorRole      viewer's role ("party_a" | "party_b" | null)
 */
export function shouldMaskPrivateSender(
  isPrivateMode: boolean,
  actorRole: string | null | undefined,
): boolean {
  if (!isPrivateMode) return false;
  const role = String(actorRole || '').trim().toLowerCase();
  return role === 'party_b';
}

/**
 * Apply private-mode masking to a serialized proposal row object that is
 * being returned to a recipient viewer.
 *
 * Nulls out fields that identify the sender:
 *   - party_a_email
 *   - counterparty_email    (for list responses where this === party_a_email)
 *   - owner_user_id
 *
 * Does NOT mutate the input; always returns a new object.
 */
export function applyPrivateModeMask<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    party_a_email: null,
    counterparty_email: null,
    owner_user_id: null,
  };
}
