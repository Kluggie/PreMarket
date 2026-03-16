import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendAssistantEntry,
  appendUserEntry,
  buildThreadHistoryForRequest,
  canCreateThread,
  createThread,
  deleteThread,
  deriveThreadTitle,
  deserializeThreadsFromMetadata,
  ensureActiveThread,
  generateThreadId,
  getActiveThread,
  getLastAssistantEntry,
  MAX_THREADS,
  normalizeThreadsOnLoad,
  renameThread,
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

test('createThread prepends new thread when active thread is non-empty', () => {
  // Must start from a non-empty thread (can't stack empty threads)
  let st = appendUserEntry([], null, { content: 'first question', promptType: 'risks' });
  const result = createThread(st.threads, st.activeThreadId);
  assert.equal(result.threads.length, 2);
  assert.equal(result.threads[0].id, result.activeThreadId);
  assert.notEqual(result.activeThreadId, st.activeThreadId);
  assert.equal(result.created, true);
  assert.equal(result.threads[1].id, st.activeThreadId);
});

test('createThread blocks creation at MAX_THREADS (3) and returns created:false', () => {
  // Build exactly MAX_THREADS non-empty threads
  let st = appendUserEntry([], null, { content: 'q1', promptType: 'risks' });
  assert.equal(MAX_THREADS, 3);
  let st2 = createThread(st.threads, st.activeThreadId);
  let st2w = appendUserEntry(st2.threads, st2.activeThreadId, { content: 'q2', promptType: 'risks' });
  let st3 = createThread(st2w.threads, st2w.activeThreadId);
  let st3w = appendUserEntry(st3.threads, st3.activeThreadId, { content: 'q3', promptType: 'risks' });
  assert.equal(st3w.threads.length, MAX_THREADS);
  // Try to create a 4th
  const result = createThread(st3w.threads, st3w.activeThreadId);
  assert.equal(result.created, false);
  assert.equal(result.threads.length, MAX_THREADS);
  assert.equal(result.activeThreadId, st3w.activeThreadId); // unchanged
});

// ── ensureActiveThread ───────────────────────────────────────────────────

test('ensureActiveThread returns existing thread if id matches', () => {
  const threads = [{ id: 'x', title: 'X', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = ensureActiveThread(threads, 'x');
  assert.equal(result.activeThreadId, 'x');
  assert.equal(result.threads, threads);
});

test('ensureActiveThread falls back to first existing thread if id does not match', () => {
  const threads = [{ id: 'x', title: 'X', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = ensureActiveThread(threads, 'nonexistent');
  // Falls back to the first existing thread rather than creating another empty one
  assert.equal(result.activeThreadId, 'x');
  assert.equal(result.threads.length, 1);
  assert.equal(result.threads, threads);
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

// ── canCreateThread ──────────────────────────────────────────────────────

test('canCreateThread allows creation when no threads exist', () => {
  assert.equal(canCreateThread([], null), true);
});

test('canCreateThread allows creation when all threads are non-empty and below limit', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  assert.equal(canCreateThread(st.threads, st.activeThreadId), true);
});

test('canCreateThread blocks creation when active thread is empty', () => {
  const emptyThread = { id: 'e1', title: 'New thread', createdAt: 1, updatedAt: 1, entries: [] };
  assert.equal(canCreateThread([emptyThread], 'e1'), false);
});

test('canCreateThread blocks creation when any thread is empty (no stacking)', () => {
  const emptyThread = { id: 'e1', title: 'New thread', createdAt: 1, updatedAt: 1, entries: [] };
  // Simulate: existing non-active empty thread (should still block)
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  // Active is non-empty, but add a second empty thread manually
  const mixed = [...st.threads, emptyThread];
  assert.equal(canCreateThread(mixed, st.activeThreadId), false);
});

test('canCreateThread blocks creation when at MAX_THREADS limit', () => {
  let st = appendUserEntry([], null, { content: 'q1', promptType: 'risks' });
  let st2 = createThread(st.threads, st.activeThreadId);
  let st2w = appendUserEntry(st2.threads, st2.activeThreadId, { content: 'q2', promptType: 'risks' });
  let st3 = createThread(st2w.threads, st2w.activeThreadId);
  let st3w = appendUserEntry(st3.threads, st3.activeThreadId, { content: 'q3', promptType: 'risks' });
  assert.equal(st3w.threads.length, MAX_THREADS);
  assert.equal(canCreateThread(st3w.threads, st3w.activeThreadId), false);
});

// ── createThread — new behavior ──────────────────────────────────────────

test('createThread returns created:false when active thread is empty', () => {
  const result = createThread([], null); // creates first thread (ok, no threads yet)
  assert.equal(result.created, true);
  // Now try to create again while on empty active thread
  const result2 = createThread(result.threads, result.activeThreadId);
  assert.equal(result2.created, false);
  assert.equal(result2.threads.length, 1);
  assert.equal(result2.activeThreadId, result.activeThreadId);
});

test('createThread returns created:true when active thread is non-empty', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const result = createThread(st.threads, st.activeThreadId);
  assert.equal(result.created, true);
  assert.equal(result.threads.length, 2);
  assert.notEqual(result.activeThreadId, st.activeThreadId);
});

// ── deleteThread ─────────────────────────────────────────────────────────

test('deleteThread removes a non-active thread', () => {
  let st = appendUserEntry([], null, { content: 'q1', promptType: 'risks' });
  const thread1Id = st.activeThreadId;
  let st2 = createThread(st.threads, st.activeThreadId);
  let st2w = appendUserEntry(st2.threads, st2.activeThreadId, { content: 'q2', promptType: 'general' });
  // Active is thread2; delete thread1
  const result = deleteThread(st2w.threads, st2w.activeThreadId, thread1Id);
  assert.equal(result.threads.length, 1);
  assert.equal(result.threads[0].id, st2w.activeThreadId);
  assert.equal(result.activeThreadId, st2w.activeThreadId);
});

test('deleteThread on active thread switches to another thread', () => {
  let st = appendUserEntry([], null, { content: 'q1', promptType: 'risks' });
  const thread1Id = st.activeThreadId;
  let st2 = createThread(st.threads, st.activeThreadId);
  let st2w = appendUserEntry(st2.threads, st2.activeThreadId, { content: 'q2', promptType: 'general' });
  const thread2Id = st2w.activeThreadId;
  // Active is thread2; delete thread2 (the active one)
  const result = deleteThread(st2w.threads, thread2Id, thread2Id);
  assert.equal(result.threads.length, 1);
  assert.equal(result.activeThreadId, thread1Id);
  assert.notEqual(result.activeThreadId, thread2Id);
});

test('deleteThread on active thread prefers non-empty fallback', () => {
  // Thread 1 (non-empty), Thread 2 (active, empty) → delete thread 2 → fall back to thread 1
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const thread1Id = st.activeThreadId;
  let st2 = createThread(st.threads, st.activeThreadId); // thread2 is empty
  const thread2Id = st2.activeThreadId;
  const result = deleteThread(st2.threads, thread2Id, thread2Id);
  assert.equal(result.activeThreadId, thread1Id);
});

test('deleteThread on the last remaining thread returns empty state', () => {
  const threads = [{ id: 't1', title: 'Thread 1', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = deleteThread(threads, 't1', 't1');
  assert.equal(result.threads.length, 0);
  assert.equal(result.activeThreadId, null);
});

test('deleteThread with unknown id returns state unchanged', () => {
  const threads = [{ id: 't1', title: 'Thread 1', createdAt: 1, updatedAt: 1, entries: [] }];
  const result = deleteThread(threads, 't1', 'nonexistent');
  assert.equal(result.threads.length, 1);
  assert.equal(result.activeThreadId, 't1');
});

// ── renameThread ─────────────────────────────────────────────────────────

test('renameThread updates the title of the target thread', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const updated = renameThread(st.threads, st.activeThreadId, 'My analysis session');
  assert.equal(updated[0].title, 'My analysis session');
});

test('renameThread trims whitespace', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const updated = renameThread(st.threads, st.activeThreadId, '  Custom Name  ');
  assert.equal(updated[0].title, 'Custom Name');
});

test('renameThread ignores blank new title', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const before = st.threads[0].title;
  const updated = renameThread(st.threads, st.activeThreadId, '   ');
  assert.equal(updated[0].title, before); // unchanged
});

test('renameThread returns threads unchanged for unknown threadId', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const updated = renameThread(st.threads, 'nonexistent', 'New name');
  assert.equal(updated[0].title, st.threads[0].title);
});

// ── normalizeThreadsOnLoad ───────────────────────────────────────────────

test('normalizeThreadsOnLoad returns unchanged when at or below MAX_THREADS', () => {
  let st = appendUserEntry([], null, { content: 'q', promptType: 'risks' });
  const result = normalizeThreadsOnLoad(st.threads, st.activeThreadId);
  assert.equal(result.threads, st.threads);
  assert.equal(result.activeThreadId, st.activeThreadId);
});

test('normalizeThreadsOnLoad trims to MAX_THREADS (3) from a larger set', () => {
  // Build 5 threads (simulating old drafts with higher limit)
  const threads = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    title: `Thread ${i}`,
    createdAt: i,
    updatedAt: i,
    entries: i === 0 ? [] : [{ role: 'user', content: `q${i}` }],
  }));
  const result = normalizeThreadsOnLoad(threads, 't2');
  assert.equal(result.threads.length, MAX_THREADS);
});

test('normalizeThreadsOnLoad keeps active thread even if it would be trimmed', () => {
  const threads = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`,
    title: `Thread ${i}`,
    createdAt: i,
    updatedAt: i,
    entries: [{ role: 'user', content: `q${i}` }],
  }));
  // Active is the last (lowest priority) thread
  const result = normalizeThreadsOnLoad(threads, 't5');
  assert.ok(result.threads.some((t) => t.id === 't5'), 'active thread must be kept');
  assert.equal(result.activeThreadId, 't5');
  assert.equal(result.threads.length, MAX_THREADS);
});

test('normalizeThreadsOnLoad prefers non-empty threads over empty ones', () => {
  const threads = [
    { id: 'empty1', title: 'E1', createdAt: 10, updatedAt: 10, entries: [] },
    { id: 'empty2', title: 'E2', createdAt: 9, updatedAt: 9, entries: [] },
    { id: 'full1', title: 'F1', createdAt: 8, updatedAt: 8, entries: [{ role: 'user', content: 'q' }] },
    { id: 'full2', title: 'F2', createdAt: 7, updatedAt: 7, entries: [{ role: 'user', content: 'q' }] },
    { id: 'full3', title: 'F3', createdAt: 6, updatedAt: 6, entries: [{ role: 'user', content: 'q' }] },
  ];
  // Active is empty1 (stays due to active priority)
  const result = normalizeThreadsOnLoad(threads, 'empty1');
  assert.equal(result.threads.length, MAX_THREADS);
  const ids = result.threads.map((t) => t.id);
  assert.ok(ids.includes('empty1'), 'active thread kept');
  assert.ok(ids.includes('full1'), 'newest non-empty kept');
  assert.ok(ids.includes('full2'), 'second non-empty kept');
  assert.ok(!ids.includes('empty2'), 'non-active empty trimmed');
});

test('deserializeThreadsFromMetadata normalises old drafts with >3 threads', () => {
  const oldDraft = {
    suggestionThreads: Array.from({ length: 7 }, (_, i) => ({
      id: `t${i}`,
      title: `Thread ${i}`,
      createdAt: i,
      updatedAt: i,
      entries: [{ role: 'user', content: `question ${i}`, timestamp: i, promptType: 'risks' }],
    })),
    activeSuggestionThreadId: 't3',
  };
  const result = deserializeThreadsFromMetadata(oldDraft);
  assert.ok(result.threads.length <= MAX_THREADS, `should have at most ${MAX_THREADS} threads`);
  assert.ok(result.threads.some((t) => t.id === 't3'), 'active thread must be preserved');
  assert.equal(result.activeThreadId, 't3');
});

// ── Thread persistence after delete / create ─────────────────────────────

test('thread persistence after delete works (serialize → deserialize roundtrip)', () => {
  let st = appendUserEntry([], null, { content: 'q1', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'a1', coachResultHash: 'h1' });
  const thread1Id = st.activeThreadId;
  let st2 = createThread(st.threads, st.activeThreadId);
  let st2w = appendUserEntry(st2.threads, st2.activeThreadId, { content: 'q2', promptType: 'general' });
  st2w = appendAssistantEntry(st2w.threads, st2w.activeThreadId, { content: 'a2', coachResultHash: 'h2' });
  const thread2Id = st2w.activeThreadId;

  // Delete thread1
  const afterDelete = deleteThread(st2w.threads, thread2Id, thread1Id);
  assert.equal(afterDelete.threads.length, 1);

  // Serialize and restore
  const serialized = serializeThreadsForPersistence(afterDelete.threads, afterDelete.activeThreadId);
  const restored = deserializeThreadsFromMetadata(serialized);
  assert.equal(restored.threads.length, 1);
  assert.equal(restored.threads[0].id, thread2Id);
  assert.equal(restored.activeThreadId, thread2Id);
});

test('thread persistence after create works (serialize → deserialize roundtrip)', () => {
  let st = appendUserEntry([], null, { content: 'q1', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'a1', coachResultHash: 'h1' });

  // Create second thread and add entry
  let st2 = createThread(st.threads, st.activeThreadId);
  let st2w = appendUserEntry(st2.threads, st2.activeThreadId, { content: 'q2', promptType: 'general' });
  st2w = appendAssistantEntry(st2w.threads, st2w.activeThreadId, { content: 'a2', coachResultHash: 'h2' });

  const serialized = serializeThreadsForPersistence(st2w.threads, st2w.activeThreadId);
  const restored = deserializeThreadsFromMetadata(serialized);
  assert.equal(restored.threads.length, 2);
  assert.equal(restored.activeThreadId, st2w.activeThreadId);
  assert.equal(restored.threads[0].entries.length, 2);
  assert.equal(restored.threads[1].entries.length, 2);
});

// ── No regression: suggestion prompts / custom prompts continue thread ──

test('regression: suggested prompts still continue active thread after new rules', () => {
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'Here are risks', coachResultHash: 'h1' });
  const threadId = st.activeThreadId;

  // Suggested prompt click → continues same thread
  const continued = appendUserEntry(st.threads, threadId, { content: 'Negotiation Strategy', promptType: 'negotiate' });
  assert.equal(continued.threads.length, 1);
  assert.equal(continued.activeThreadId, threadId);
  assert.equal(continued.threads[0].entries.length, 3);
});

test('regression: custom prompts still continue active thread after new rules', () => {
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'Here are risks', coachResultHash: 'h1' });
  const threadId = st.activeThreadId;

  const continued = appendUserEntry(st.threads, threadId, { content: 'Tell me more about clause 4', promptType: 'custom_prompt' });
  assert.equal(continued.threads.length, 1);
  assert.equal(continued.activeThreadId, threadId);
  assert.equal(continued.threads[0].entries.length, 3);
  assert.equal(continued.threads[0].entries[2].promptType, 'custom_prompt');
});
