import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendAssistantEntry,
  appendUserEntry,
  buildThreadHistoryForRequest,
  createThread,
  deriveThreadTitle,
  deserializeThreadsFromMetadata,
  ensureActiveThread,
  generateThreadId,
  getActiveThread,
  getLastAssistantEntry,
  MAX_THREADS,
  serializeThreadsForPersistence,
  THREAD_HISTORY_WINDOW,
} from '../../src/pages/document-comparison/suggestionThreads.js';

// ── generateThreadId ─────────────────────────────────────────────────────

test('generateThreadId returns unique ids on successive calls', () => {
  const a = generateThreadId();
  const b = generateThreadId();
  assert.notEqual(a, b);
  assert.ok(a.startsWith('sthread_'));
  assert.ok(b.startsWith('sthread_'));
});

// ── deriveThreadTitle ────────────────────────────────────────────────────

test('deriveThreadTitle uses intent label for non-custom prompts', () => {
  assert.equal(deriveThreadTitle({ promptType: 'negotiate', content: 'whatever' }), 'Negotiation Strategy');
  assert.equal(deriveThreadTitle({ promptType: 'risks', content: '' }), 'Risks & Gaps');
  assert.equal(deriveThreadTitle({ promptType: 'general', content: '' }), 'General Improvements');
});

test('deriveThreadTitle truncates long custom prompt content', () => {
  const longContent = 'A'.repeat(100);
  const title = deriveThreadTitle({ promptType: 'custom_prompt', content: longContent });
  assert.ok(title.length <= 50);
  assert.ok(title.endsWith('…'));
});

test('deriveThreadTitle falls back to content for custom prompt', () => {
  const title = deriveThreadTitle({ promptType: 'custom_prompt', content: 'What are the risks?' });
  assert.equal(title, 'What are the risks?');
});

test('deriveThreadTitle returns "New thread" for null entry', () => {
  assert.equal(deriveThreadTitle(null), 'New thread');
});

// ── createThread ─────────────────────────────────────────────────────────

test('createThread starts an empty thread and sets it as active', () => {
  const result = createThread([]);
  assert.equal(result.threads.length, 1);
  assert.equal(result.activeThreadId, result.threads[0].id);
  assert.equal(result.threads[0].title, 'New thread');
  assert.equal(result.threads[0].entries.length, 0);
});

test('createThread prepends to existing threads', () => {
  const existing = [{ id: 'old1', title: 'Old', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = createThread(existing);
  assert.equal(result.threads.length, 2);
  assert.equal(result.threads[0].id, result.activeThreadId);
  assert.equal(result.threads[1].id, 'old1');
});

test('createThread caps at MAX_THREADS', () => {
  const existing = Array.from({ length: MAX_THREADS + 5 }, (_, i) => ({
    id: `t${i}`,
    title: `Thread ${i}`,
    createdAt: i,
    updatedAt: i,
    entries: [],
  }));
  const result = createThread(existing);
  assert.ok(result.threads.length <= MAX_THREADS);
  assert.equal(result.threads[0].id, result.activeThreadId);
});

// ── ensureActiveThread ───────────────────────────────────────────────────

test('ensureActiveThread returns existing thread if id matches', () => {
  const threads = [{ id: 'x', title: 'X', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = ensureActiveThread(threads, 'x');
  assert.equal(result.activeThreadId, 'x');
  assert.equal(result.threads, threads);
});

test('ensureActiveThread creates a thread if id does not match', () => {
  const threads = [{ id: 'x', title: 'X', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = ensureActiveThread(threads, 'nonexistent');
  assert.notEqual(result.activeThreadId, 'x');
  assert.equal(result.threads.length, 2);
});

test('ensureActiveThread creates a thread if none exist', () => {
  const result = ensureActiveThread([], null);
  assert.equal(result.threads.length, 1);
  assert.ok(result.activeThreadId);
});

// ── appendUserEntry ──────────────────────────────────────────────────────

test('first prompt auto-creates a thread', () => {
  const result = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
    intent: 'risks',
  });
  assert.equal(result.threads.length, 1);
  assert.ok(result.activeThreadId);
  const thread = result.threads[0];
  assert.equal(thread.entries.length, 1);
  assert.equal(thread.entries[0].role, 'user');
  assert.equal(thread.entries[0].content, 'Risks & Gaps');
  assert.equal(thread.entries[0].promptType, 'risks');
  assert.equal(thread.title, 'Risks & Gaps');
});

test('suggested prompt clicks continue the active thread', () => {
  const first = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
    intent: 'risks',
  });
  const second = appendUserEntry(first.threads, first.activeThreadId, {
    content: 'Negotiation Strategy',
    promptType: 'negotiate',
    intent: 'negotiate',
  });
  assert.equal(second.threads.length, 1);
  assert.equal(second.activeThreadId, first.activeThreadId);
  const thread = second.threads[0];
  assert.equal(thread.entries.length, 2);
  assert.equal(thread.entries[0].content, 'Risks & Gaps');
  assert.equal(thread.entries[1].content, 'Negotiation Strategy');
  // Title should remain the first entry's derived title
  assert.equal(thread.title, 'Risks & Gaps');
});

test('custom prompt submission continues the active thread', () => {
  const first = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
    intent: 'risks',
  });
  const second = appendUserEntry(first.threads, first.activeThreadId, {
    content: 'Tell me more about clause 3',
    promptType: 'custom_prompt',
    intent: 'custom_prompt',
  });
  assert.equal(second.threads.length, 1);
  assert.equal(second.activeThreadId, first.activeThreadId);
  const thread = second.threads[0];
  assert.equal(thread.entries.length, 2);
  assert.equal(thread.entries[1].content, 'Tell me more about clause 3');
});

// ── appendAssistantEntry ─────────────────────────────────────────────────

test('appendAssistantEntry adds assistant message to active thread', () => {
  const userResult = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
  });
  const assistantResult = appendAssistantEntry(
    userResult.threads,
    userResult.activeThreadId,
    {
      content: 'Here are the risks...',
      coachResult: { version: 'test', summary: { overall: 'Here are the risks...' } },
      coachResultHash: 'abc123',
      coachCached: false,
      coachRequestMeta: { intent: 'risks' },
      withheldCount: 0,
    },
  );
  const thread = assistantResult.threads[0];
  assert.equal(thread.entries.length, 2);
  assert.equal(thread.entries[1].role, 'assistant');
  assert.equal(thread.entries[1].content, 'Here are the risks...');
  assert.equal(thread.entries[1].coachResultHash, 'abc123');
});

// ── getActiveThread / getLastAssistantEntry ──────────────────────────────

test('getActiveThread returns the matching thread', () => {
  const threads = [
    { id: 'a', entries: [] },
    { id: 'b', entries: [{ role: 'assistant', content: 'hello' }] },
  ];
  assert.equal(getActiveThread(threads, 'b').id, 'b');
  assert.equal(getActiveThread(threads, 'missing'), null);
  assert.equal(getActiveThread(threads, null), null);
});

test('getLastAssistantEntry returns last assistant entry', () => {
  const thread = {
    entries: [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ],
  };
  assert.equal(getLastAssistantEntry(thread).content, 'a2');
});

test('getLastAssistantEntry returns null if no assistant entries', () => {
  assert.equal(getLastAssistantEntry({ entries: [{ role: 'user', content: 'q1' }] }), null);
  assert.equal(getLastAssistantEntry(null), null);
});

// ── buildThreadHistoryForRequest ─────────────────────────────────────────

test('buildThreadHistoryForRequest returns bounded window from active thread', () => {
  // Build a thread with many entries
  let result = appendUserEntry([], null, { content: 'msg1', promptType: 'risks' });
  for (let i = 2; i <= 10; i++) {
    result = appendUserEntry(result.threads, result.activeThreadId, {
      content: `msg${i}`,
      promptType: 'custom_prompt',
    });
  }
  const history = buildThreadHistoryForRequest(result.threads, result.activeThreadId);
  assert.ok(history.length <= THREAD_HISTORY_WINDOW);
  // Should include the most recent entries
  const lastEntry = history[history.length - 1];
  assert.equal(lastEntry.content, 'msg10');
});

test('buildThreadHistoryForRequest returns empty for missing thread', () => {
  assert.deepEqual(buildThreadHistoryForRequest([], 'nonexistent'), []);
  assert.deepEqual(buildThreadHistoryForRequest([], null), []);
});

test('buildThreadHistoryForRequest returns lightweight entries (no coachResult)', () => {
  const userResult = appendUserEntry([], null, { content: 'question', promptType: 'risks' });
  const withAssistant = appendAssistantEntry(
    userResult.threads,
    userResult.activeThreadId,
    {
      content: 'answer text',
      coachResult: { version: 'test', summary: { overall: 'answer' }, suggestions: [] },
      coachResultHash: 'h1',
      coachCached: false,
    },
  );
  const history = buildThreadHistoryForRequest(withAssistant.threads, withAssistant.activeThreadId);
  assert.equal(history.length, 2);
  assert.equal(history[1].role, 'assistant');
  assert.ok(!history[1].coachResult, 'coachResult should not be in history for request');
});

// ── Start new thread creates clean active thread ─────────────────────────

test('starting a new thread creates a clean active thread', () => {
  // Simulate: user has existing thread with entries
  let st = appendUserEntry([], null, { content: 'initial', promptType: 'general' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'response',
    coachResult: null,
    coachResultHash: 'h1',
  });
  const oldThreadId = st.activeThreadId;

  // Start new thread
  const newResult = createThread(st.threads);
  assert.notEqual(newResult.activeThreadId, oldThreadId);
  assert.equal(newResult.threads.length, 2);
  const newThread = newResult.threads.find((t) => t.id === newResult.activeThreadId);
  assert.equal(newThread.entries.length, 0);
  assert.equal(newThread.title, 'New thread');

  // Old thread still exists
  const oldThread = newResult.threads.find((t) => t.id === oldThreadId);
  assert.ok(oldThread);
  assert.equal(oldThread.entries.length, 2);
});

// ── Selecting older thread changes which history is sent ─────────────────

test('selecting an older thread changes which history is sent', () => {
  // Thread 1
  let st1 = appendUserEntry([], null, { content: 'thread1_msg1', promptType: 'risks' });
  st1 = appendAssistantEntry(st1.threads, st1.activeThreadId, { content: 'thread1_resp1' });
  const thread1Id = st1.activeThreadId;

  // Create Thread 2
  const st2 = createThread(st1.threads);
  const thread2Id = st2.activeThreadId;
  let st2Updated = appendUserEntry(st2.threads, thread2Id, { content: 'thread2_msg1', promptType: 'general' });
  st2Updated = appendAssistantEntry(st2Updated.threads, thread2Id, { content: 'thread2_resp1' });

  // History for thread 2
  const history2 = buildThreadHistoryForRequest(st2Updated.threads, thread2Id);
  assert.ok(history2.some((e) => e.content === 'thread2_msg1'));
  assert.ok(!history2.some((e) => e.content === 'thread1_msg1'));

  // Switch to thread 1
  const history1 = buildThreadHistoryForRequest(st2Updated.threads, thread1Id);
  assert.ok(history1.some((e) => e.content === 'thread1_msg1'));
  assert.ok(!history1.some((e) => e.content === 'thread2_msg1'));
});

// ── Serialization / Deserialization ──────────────────────────────────────

test('serializeThreadsForPersistence and deserializeThreadsFromMetadata roundtrip', () => {
  let st = appendUserEntry([], null, { content: 'hello', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'response',
    coachResult: { version: 'test', summary: { overall: 'response' } },
    coachResultHash: 'h1',
    coachCached: false,
    coachRequestMeta: { intent: 'risks' },
    withheldCount: 0,
  });
  const serialized = serializeThreadsForPersistence(st.threads, st.activeThreadId);
  assert.ok(Array.isArray(serialized.suggestionThreads));
  assert.equal(serialized.activeSuggestionThreadId, st.activeThreadId);

  const deserialized = deserializeThreadsFromMetadata(serialized);
  assert.equal(deserialized.threads.length, 1);
  assert.equal(deserialized.activeThreadId, st.activeThreadId);
  assert.equal(deserialized.threads[0].entries.length, 2);
  assert.equal(deserialized.threads[0].entries[0].role, 'user');
  assert.equal(deserialized.threads[0].entries[1].role, 'assistant');
  // Last assistant should have coachResult preserved
  assert.ok(deserialized.threads[0].entries[1].coachResult);
});

test('thread persists across step navigation (serialize → deserialize)', () => {
  // Simulate: user builds a thread, saves draft, navigates away, comes back
  let st = appendUserEntry([], null, { content: 'first question', promptType: 'general' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'first answer',
    coachResult: { version: 'test' },
    coachResultHash: 'h1',
  });
  st = appendUserEntry(st.threads, st.activeThreadId, {
    content: 'follow-up',
    promptType: 'custom_prompt',
  });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'follow-up answer',
    coachResult: { version: 'test', custom_feedback: 'follow-up answer' },
    coachResultHash: 'h2',
  });

  // Serialize (draft save)
  const serialized = serializeThreadsForPersistence(st.threads, st.activeThreadId);
  const metadata = {
    suggestionThreads: serialized.suggestionThreads,
    activeSuggestionThreadId: serialized.activeSuggestionThreadId,
  };

  // Deserialize (draft hydration after returning to step 2)
  const restored = deserializeThreadsFromMetadata(metadata);
  assert.equal(restored.threads.length, 1);
  assert.equal(restored.activeThreadId, st.activeThreadId);
  assert.equal(restored.threads[0].entries.length, 4);

  // Can continue the thread
  const continued = appendUserEntry(restored.threads, restored.activeThreadId, {
    content: 'another follow-up',
    promptType: 'custom_prompt',
  });
  assert.equal(continued.threads[0].entries.length, 5);
  assert.equal(continued.activeThreadId, st.activeThreadId);
});

test('deserializeThreadsFromMetadata handles missing/empty metadata', () => {
  assert.deepEqual(deserializeThreadsFromMetadata(null), { threads: [], activeThreadId: null });
  assert.deepEqual(deserializeThreadsFromMetadata({}), { threads: [], activeThreadId: null });
  assert.deepEqual(deserializeThreadsFromMetadata({ suggestionThreads: [] }), { threads: [], activeThreadId: null });
});

test('deserializeThreadsFromMetadata falls back to first thread if active id missing', () => {
  const metadata = {
    suggestionThreads: [
      { id: 't1', title: 'Thread 1', createdAt: 1, updatedAt: 1, entries: [] },
    ],
    activeSuggestionThreadId: 'nonexistent',
  };
  const result = deserializeThreadsFromMetadata(metadata);
  assert.equal(result.activeThreadId, 't1');
});

// ── No regression: existing suggestion behavior ──────────────────────────

test('no regression: first suggestion works with empty thread state', () => {
  // Simulate the exact flow: empty state → first suggestion → response
  const userResult = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
    intent: 'risks',
  });
  assert.equal(userResult.threads.length, 1);
  assert.ok(userResult.activeThreadId);
  const thread = userResult.threads[0];
  assert.equal(thread.entries.length, 1);
  assert.equal(thread.title, 'Risks & Gaps');

  // Build history — should include the just-added user entry
  const history = buildThreadHistoryForRequest(userResult.threads, userResult.activeThreadId);
  assert.equal(history.length, 1);
  assert.equal(history[0].role, 'user');
});

// ── Document snapshot always included (test the history shape) ───────────

test('thread history for request only contains bounded entries, not doc snapshot', () => {
  // The document snapshot is handled outside the thread model —
  // thread history should NOT contain document text.
  let st = appendUserEntry([], null, { content: 'question', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'answer about risks',
    coachResult: null,
    coachResultHash: 'h1',
  });
  const history = buildThreadHistoryForRequest(st.threads, st.activeThreadId);
  for (const entry of history) {
    assert.ok(!entry.docAText, 'history should not contain document text');
    assert.ok(!entry.docBText, 'history should not contain document text');
  }
});
