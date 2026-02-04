import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

/**
 * Safely resolve a proposal id from multiple possible shapes.
 * Accepts either a proposal object or falsy (to fallback to route param).
 */
export function getProposalId(proposal) {
  if (!proposal) {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || null;
  }

  if (typeof proposal === 'string') return proposal;

  return proposal.id || proposal._id || proposal.proposalId || (new URLSearchParams(window.location.search)).get('id') || null;
}
