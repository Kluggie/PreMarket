/**
 * Shared recipient display helpers.
 */

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
