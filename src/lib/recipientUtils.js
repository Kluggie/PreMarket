/**
 * Shared recipient display helpers.
 */

/** Label used for the sender identity when a proposal is in Private Mode and the viewer is the recipient. */
export const PRIVATE_SENDER_LABEL = 'Private sender';

/**
 * Format the "With:" label shown on proposal/comparison list items.
 *
 * Priority:
 *   name + email  →  "With: Sarah Chen · sarah@company.com"
 *   name only     →  "With: Sarah Chen"
 *   email only    →  "With: sarah@company.com"
 *   neither       →  "With: Not specified"
 *
 * @param {string|null|undefined} name
 * @param {string|null|undefined} email
 * @returns {string}
 */
export function formatRecipientLabel(name, email) {
  const n = String(name || '').trim();
  const e = String(email || '').trim();
  if (n && e) return `With: ${n} · ${e}`;
  if (n) return `With: ${n}`;
  if (e) return `With: ${e}`;
  return 'With: Not specified';
}

/**
 * Same as formatRecipientLabel but without the "With: " prefix.
 * Useful when the "With:" label is rendered separately.
 *
 * @param {string|null|undefined} name
 * @param {string|null|undefined} email
 * @returns {string}
 */
export function formatRecipientShort(name, email) {
  const n = String(name || '').trim();
  const e = String(email || '').trim();
  if (n && e) return `${n} · ${e}`;
  if (n) return n;
  if (e) return e;
  return 'Not specified';
}

/**
 * Returns true when the proposal list/detail row should hide sender identity
 * from the current viewer.
 *
 * @param {boolean} isPrivateMode
 * @param {string|null|undefined} latestDirection  "received" | "sent" | null
 * @param {string|null|undefined} ownerUserId      owner user id from the row
 * @param {string|null|undefined} currentUserId    logged-in user id
 * @returns {boolean}
 */
export function shouldMaskPrivateSenderUI(isPrivateMode, latestDirection, ownerUserId, currentUserId) {
  if (!isPrivateMode) return false;
  // If this user is the owner, never mask.
  if (currentUserId && ownerUserId && String(currentUserId) === String(ownerUserId)) return false;
  // If latestDirection is "received" this viewer is the recipient.
  return String(latestDirection || '').toLowerCase() === 'received';
}
