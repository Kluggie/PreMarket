/**
 * useGuestDraft — localStorage-based draft persistence for unauthenticated users.
 *
 * The draft is stored under the key GUEST_DRAFT_KEY and holds:
 *   {
 *     templateSlug:  string | null,
 *     templateId:    string | null,     // built-in id
 *     proposalTitle: string,
 *     recipientEmail: string,
 *     presetKey:     string,
 *     responses:     Record<string, unknown>,
 *     visibilitySettings: Record<string, string>,
 *     isPrivateMode: boolean,
 *     step:          number,
 *     savedAt:       string,            // ISO timestamp
 *   }
 *
 * Security notes:
 *  - Only stored in the current browser's localStorage — never sent to the server
 *    until the user signs in.
 *  - On sign-in the draft is migrated via the normal authenticated API.
 *  - The key is scoped to "pm:" namespace to avoid collisions.
 */

import { useCallback, useEffect, useState } from 'react';

const GUEST_DRAFT_KEY = 'pm:guest_draft';
const DRAFT_VERSION = 1;

/** Drafts older than this are silently discarded. Exported for tests. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Safely read from localStorage; returns null on any error or if draft is expired. */
function readLocalDraft() {
  try {
    const raw = localStorage.getItem(GUEST_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Version guard — discard drafts from incompatible schema
    if (parsed._v && parsed._v !== DRAFT_VERSION) return null;
    // Expiry guard — discard drafts older than DRAFT_MAX_AGE_MS
    if (parsed.savedAt) {
      const age = Date.now() - new Date(parsed.savedAt).getTime();
      if (age > DRAFT_MAX_AGE_MS) {
        clearLocalDraft();
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Safely write to localStorage; silently fails (e.g. private-mode quota exceeded). */
function writeLocalDraft(draft) {
  try {
    localStorage.setItem(GUEST_DRAFT_KEY, JSON.stringify({ ...draft, _v: DRAFT_VERSION }));
  } catch {
    // Quota exceeded or security error — ignore silently.
  }
}

/** Remove the guest draft from localStorage. */
function clearLocalDraft() {
  try {
    localStorage.removeItem(GUEST_DRAFT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Hook that provides a guest draft stored in localStorage.
 *
 * Returns:
 *   guestDraft  — current draft object (or null if no draft saved)
 *   saveGuestDraft(draft) — persists the draft to localStorage
 *   clearGuestDraft()     — removes the draft from localStorage
 *   hasGuestDraft         — boolean shorthand
 */
export function useGuestDraft() {
  const [guestDraft, setGuestDraft] = useState(() => readLocalDraft());

  // Re-sync if another tab/window clears the draft.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === GUEST_DRAFT_KEY) {
        setGuestDraft(event.newValue ? readLocalDraft() : null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const saveGuestDraft = useCallback((draft) => {
    const toSave = { ...draft, savedAt: new Date().toISOString() };
    writeLocalDraft(toSave);
    setGuestDraft(toSave);
  }, []);

  const clearGuestDraft = useCallback(() => {
    clearLocalDraft();
    setGuestDraft(null);
  }, []);

  return {
    guestDraft,
    saveGuestDraft,
    clearGuestDraft,
    hasGuestDraft: guestDraft != null,
  };
}
