/**
 * Lightweight thread model for Step 2 "Ask for Suggestions" workspace.
 *
 * Each thread is a single conversational session containing user prompts and
 * AI assistant responses.  The active thread is where new prompts/responses
 * are appended.  Starting a "new thread" creates a fresh session so the AI
 * no longer receives the prior thread's context.
 *
 * Persistence: threads are serialised into the draft metadata JSON and
 * restored on hydration — no schema migration required.
 */

// ── Constants ────────────────────────────────────────────────────────────
export const MAX_THREADS = 10;
export const MAX_ENTRIES_PER_THREAD = 20;
/** How many recent entries (from the active thread) to include in AI requests. */
export const THREAD_HISTORY_WINDOW = 6;
/** Max chars of assistant content stored per entry for persistence. */
const MAX_PERSISTED_CONTENT_CHARS = 4000;

// ── ID generation ────────────────────────────────────────────────────────
let _threadSeq = 0;
export function generateThreadId() {
  _threadSeq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `sthread_${Date.now()}_${_threadSeq}_${rand}`;
}

// ── Title derivation ─────────────────────────────────────────────────────
const INTENT_TITLE_MAP = {
  negotiate: 'Negotiation Strategy',
  risks: 'Risks & Gaps',
  general: 'General Improvements',
  company_brief: 'Company Brief',
  custom_prompt: 'Custom Prompt',
};

export function deriveThreadTitle(entry) {
  if (!entry) return 'New thread';
  const intentLabel = INTENT_TITLE_MAP[entry.promptType] || '';
  if (intentLabel && entry.promptType !== 'custom_prompt') return intentLabel;
  const text = String(entry.content || '').trim();
  if (!text) return intentLabel || 'New thread';
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

// ── Thread CRUD helpers ──────────────────────────────────────────────────

/**
 * Create a new empty thread and return the updated state.
 * Returns { threads, activeThreadId }.
 */
export function createThread(threads = []) {
  const id = generateThreadId();
  const now = Date.now();
  const newThread = {
    id,
    title: 'New thread',
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
  const updated = [newThread, ...threads].slice(0, MAX_THREADS);
  return { threads: updated, activeThreadId: id };
}

/**
 * Ensure an active thread exists.  If `activeThreadId` points to an existing
 * thread, return as-is.  Otherwise, create a new thread.
 */
export function ensureActiveThread(threads = [], activeThreadId = null) {
  if (activeThreadId && threads.some((t) => t.id === activeThreadId)) {
    return { threads, activeThreadId };
  }
  return createThread(threads);
}

/**
 * Append a user entry to the active thread.
 * Auto-creates a thread if none exists.
 */
export function appendUserEntry(threads, activeThreadId, { content, promptType, intent }) {
  const ensured = ensureActiveThread(threads, activeThreadId);
  let nextThreads = ensured.threads;
  const tid = ensured.activeThreadId;
  const now = Date.now();

  nextThreads = nextThreads.map((t) => {
    if (t.id !== tid) return t;
    const entry = {
      role: 'user',
      content: String(content || '').slice(0, MAX_PERSISTED_CONTENT_CHARS),
      timestamp: now,
      promptType: promptType || intent || 'custom_prompt',
    };
    const entries = [...(t.entries || []), entry].slice(-MAX_ENTRIES_PER_THREAD);
    const title = t.entries.length === 0 ? deriveThreadTitle(entry) : t.title;
    return { ...t, entries, updatedAt: now, title };
  });

  return { threads: nextThreads, activeThreadId: tid };
}

/**
 * Append an assistant entry to the active thread.
 */
export function appendAssistantEntry(
  threads,
  activeThreadId,
  { content, coachResult, coachResultHash, coachCached, coachRequestMeta, withheldCount },
) {
  if (!activeThreadId) return { threads, activeThreadId };
  const now = Date.now();

  const nextThreads = threads.map((t) => {
    if (t.id !== activeThreadId) return t;
    const entry = {
      role: 'assistant',
      content: String(content || '').slice(0, MAX_PERSISTED_CONTENT_CHARS),
      timestamp: now,
      coachResult: coachResult || null,
      coachResultHash: coachResultHash || '',
      coachCached: Boolean(coachCached),
      coachRequestMeta: coachRequestMeta || null,
      withheldCount: typeof withheldCount === 'number' ? withheldCount : 0,
    };
    const entries = [...(t.entries || []), entry].slice(-MAX_ENTRIES_PER_THREAD);
    return { ...t, entries, updatedAt: now };
  });

  return { threads: nextThreads, activeThreadId };
}

/**
 * Get the active thread object, or null.
 */
export function getActiveThread(threads, activeThreadId) {
  if (!activeThreadId || !Array.isArray(threads)) return null;
  return threads.find((t) => t.id === activeThreadId) || null;
}

/**
 * Get the last assistant entry from a thread (for restoring coach state).
 */
export function getLastAssistantEntry(thread) {
  if (!thread || !Array.isArray(thread.entries)) return null;
  for (let i = thread.entries.length - 1; i >= 0; i--) {
    if (thread.entries[i].role === 'assistant') return thread.entries[i];
  }
  return null;
}

// ── History window for AI requests ───────────────────────────────────────

/**
 * Extract a bounded window of recent thread entries for sending to the AI.
 * Returns an array of { role, content, promptType? } objects — lightweight,
 * no full coachResult objects.
 */
export function buildThreadHistoryForRequest(threads, activeThreadId) {
  const thread = getActiveThread(threads, activeThreadId);
  if (!thread || !thread.entries || thread.entries.length === 0) return [];

  // Take the last THREAD_HISTORY_WINDOW entries (excluding the upcoming user message,
  // which the caller adds to the prompt separately)
  const recent = thread.entries.slice(-THREAD_HISTORY_WINDOW);

  return recent.map((e) => ({
    role: e.role,
    content: String(e.content || '').slice(0, 2000),
    ...(e.promptType ? { promptType: e.promptType } : {}),
  }));
}

// ── Persistence helpers ──────────────────────────────────────────────────

/**
 * Serialise threads for storage in draft metadata.
 * Strips heavy fields (full coachResult) except for the last assistant entry
 * per thread to allow UI restoration.
 */
export function serializeThreadsForPersistence(threads, activeThreadId) {
  if (!Array.isArray(threads) || threads.length === 0) {
    return { suggestionThreads: [], activeSuggestionThreadId: null };
  }

  const serialised = threads.slice(0, MAX_THREADS).map((t) => {
    const entries = (t.entries || []).slice(-MAX_ENTRIES_PER_THREAD);
    // Find last assistant entry index
    let lastAssistantIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    const lightEntries = entries.map((e, idx) => {
      if (e.role === 'assistant') {
        const base = {
          role: e.role,
          content: String(e.content || '').slice(0, MAX_PERSISTED_CONTENT_CHARS),
          timestamp: e.timestamp,
          coachResultHash: e.coachResultHash || '',
          coachCached: Boolean(e.coachCached),
          withheldCount: e.withheldCount || 0,
        };
        if (e.coachRequestMeta) {
          base.coachRequestMeta = e.coachRequestMeta;
        }
        // Only persist full coachResult for the LAST assistant entry
        if (idx === lastAssistantIdx && e.coachResult) {
          base.coachResult = e.coachResult;
        }
        return base;
      }
      return {
        role: e.role,
        content: String(e.content || '').slice(0, MAX_PERSISTED_CONTENT_CHARS),
        timestamp: e.timestamp,
        promptType: e.promptType || '',
      };
    });

    return {
      id: t.id,
      title: t.title || 'Thread',
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      entries: lightEntries,
    };
  });

  return {
    suggestionThreads: serialised,
    activeSuggestionThreadId: activeThreadId || null,
  };
}

/**
 * Restore threads from saved metadata.
 * Returns { threads, activeThreadId } or defaults if missing/invalid.
 */
export function deserializeThreadsFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { threads: [], activeThreadId: null };
  }

  const raw = metadata.suggestionThreads;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { threads: [], activeThreadId: null };
  }

  const threads = raw
    .filter((t) => t && typeof t === 'object' && t.id)
    .slice(0, MAX_THREADS)
    .map((t) => ({
      id: t.id,
      title: t.title || 'Thread',
      createdAt: t.createdAt || 0,
      updatedAt: t.updatedAt || 0,
      entries: Array.isArray(t.entries)
        ? t.entries
            .filter((e) => e && (e.role === 'user' || e.role === 'assistant'))
            .slice(-MAX_ENTRIES_PER_THREAD)
            .map((e) => ({
              role: e.role,
              content: String(e.content || ''),
              timestamp: e.timestamp || 0,
              ...(e.role === 'user' ? { promptType: e.promptType || '' } : {}),
              ...(e.role === 'assistant'
                ? {
                    coachResult: e.coachResult || null,
                    coachResultHash: e.coachResultHash || '',
                    coachCached: Boolean(e.coachCached),
                    coachRequestMeta: e.coachRequestMeta || null,
                    withheldCount: e.withheldCount || 0,
                  }
                : {}),
            }))
        : [],
    }));

  let activeThreadId = metadata.activeSuggestionThreadId || null;
  if (activeThreadId && !threads.some((t) => t.id === activeThreadId)) {
    activeThreadId = threads.length > 0 ? threads[0].id : null;
  }

  return { threads, activeThreadId };
}
