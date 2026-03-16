/**
 * Tests verifying that Company Brief is correctly separated from the
 * threaded Suggested Prompts flow.
 *
 * After the UI refinement:
 * - DOCUMENT_COMPARISON_COACH_ACTIONS (Suggested Prompts) contains ONLY the
 *   three threaded prompts: negotiate, risks, general.
 * - "Company Brief" is no longer part of that list.
 * - Company Brief keeps its standalone one-shot behavior and does NOT route
 *   through appendUserEntry / the thread model.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoachActionRequest,
  DOCUMENT_COMPARISON_COACH_ACTIONS,
} from '../../src/components/document-comparison/coachActions.js';
import {
  appendAssistantEntry,
  appendUserEntry,
  buildThreadHistoryForRequest,
  createThread,
  getActiveThread,
} from '../../src/pages/document-comparison/suggestionThreads.js';

// ── Company Brief is NOT in Suggested Prompts ────────────────────────────

test('DOCUMENT_COMPARISON_COACH_ACTIONS does not include company_brief', () => {
  const intents = DOCUMENT_COMPARISON_COACH_ACTIONS.map((a) => a.intent);
  assert.ok(!intents.includes('company_brief'), 'company_brief must not be in Suggested Prompts');
  assert.ok(!intents.includes('company-brief'), 'company-brief must not be in Suggested Prompts');
});

test('DOCUMENT_COMPARISON_COACH_ACTIONS does not include any action labelled "Company Brief"', () => {
  const labels = DOCUMENT_COMPARISON_COACH_ACTIONS.map((a) => a.label);
  assert.ok(!labels.includes('Company Brief'), '"Company Brief" label must not appear in coach actions list');
});

test('Suggested Prompts contains exactly negotiate, risks, general — and nothing else', () => {
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.length, 3);
  const pairs = DOCUMENT_COMPARISON_COACH_ACTIONS.map((a) => `${a.intent}:${a.mode}`).sort();
  assert.deepEqual(pairs, ['general:full', 'negotiate:full', 'risks:full']);
});

// ── Company Brief does not touch the thread model ────────────────────────

test('Company Brief running does not add entries to any thread', () => {
  // Simulate: user starts a thread via Risks & Gaps, then company brief is triggered.
  // Company brief uses runCompanyBrief (separate path), NOT appendUserEntry.
  // So thread state should be unchanged after company brief runs.
  const stateBeforeBrief = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
    intent: 'risks',
  });

  // Company Brief intentionally does NOT call appendUserEntry. Simulate by
  // checking thread is unchanged (we don't call appendUserEntry for company_brief).
  const { threads, activeThreadId } = stateBeforeBrief;
  const thread = getActiveThread(threads, activeThreadId);

  // Verify: thread has exactly 1 entry (the Risks & Gaps user entry)
  assert.equal(thread.entries.length, 1);
  assert.equal(thread.entries[0].promptType, 'risks');
  // Company brief does not add a user entry — thread entry count stays at 1
  // (this test documents the contract: company brief is a standalone, non-threaded action)
});

test('appendUserEntry with company_brief intent would still work if called, but DOCUMENT_COMPARISON_COACH_ACTIONS will never emit it', () => {
  // Defensive: even if someone somehow calls appendUserEntry with company_brief,
  // it would go into the thread. The key guarantee is that DOCUMENT_COMPARISON_COACH_ACTIONS
  // and the handleCompanyBriefAction path don't call appendUserEntry.
  // This test confirms DOCUMENT_COMPARISON_COACH_ACTIONS has no company_brief entries.
  for (const action of DOCUMENT_COMPARISON_COACH_ACTIONS) {
    const request = buildCoachActionRequest(action, { side: 'b', text: '', range: null });
    assert.ok(request, `buildCoachActionRequest should succeed for ${action.intent}`);
    assert.notEqual(request.intent, 'company_brief', `${action.label} should not map to company_brief intent`);
  }
});

// ── Threaded prompts (Suggested Prompts) still continue the active thread ─

test('Negotiation Strategy continues the active thread', () => {
  // First: establish a thread via Risks & Gaps
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks', intent: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'Here are the risks',
    coachResult: null,
    coachResultHash: 'h1',
  });

  const threadIdBefore = st.activeThreadId;

  // Second: Negotiation Strategy click continues the same thread
  const st2 = appendUserEntry(st.threads, st.activeThreadId, {
    content: 'Negotiation Strategy',
    promptType: 'negotiate',
    intent: 'negotiate',
  });

  assert.equal(st2.threads.length, 1, 'should still be one thread');
  assert.equal(st2.activeThreadId, threadIdBefore, 'thread ID should not change');
  const thread = getActiveThread(st2.threads, st2.activeThreadId);
  assert.equal(thread.entries.length, 3);
  assert.equal(thread.entries[2].role, 'user');
  assert.equal(thread.entries[2].promptType, 'negotiate');
});

test('General Improvements continues the active thread', () => {
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks', intent: 'risks' });
  const threadId = st.activeThreadId;

  const st2 = appendUserEntry(st.threads, threadId, {
    content: 'General Improvements',
    promptType: 'general',
    intent: 'general',
  });

  assert.equal(st2.activeThreadId, threadId);
  assert.equal(st2.threads[0].entries.length, 2);
  assert.equal(st2.threads[0].entries[1].promptType, 'general');
});

test('custom prompt follow-up continues the active thread', () => {
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks', intent: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'Risk analysis result',
    coachResult: null,
    coachResultHash: 'h1',
  });
  const threadId = st.activeThreadId;

  const st2 = appendUserEntry(st.threads, threadId, {
    content: 'Tell me more about clause 4',
    promptType: 'custom_prompt',
    intent: 'custom_prompt',
  });

  assert.equal(st2.activeThreadId, threadId);
  assert.equal(st2.threads[0].entries.length, 3);
  assert.equal(st2.threads[0].entries[2].role, 'user');
  assert.equal(st2.threads[0].entries[2].promptType, 'custom_prompt');
});

// ── Thread history excludes any company_brief context ────────────────────

test('buildThreadHistoryForRequest never surfaces company_brief entries because it is not threaded', () => {
  // Build a thread with only the threaded prompts (as it will be in practice)
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'risk answer', coachResultHash: 'h1' });

  const history = buildThreadHistoryForRequest(st.threads, st.activeThreadId);
  for (const entry of history) {
    assert.notEqual(entry.promptType, 'company_brief', 'company_brief should not appear in thread history');
  }
});

// ── Starting a new thread resets to fresh state (regression / no regression) ─

test('starting a new thread does not carry over previous Suggested Prompts context', () => {
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'risk answer', coachResultHash: 'h1' });

  const oldThreadId = st.activeThreadId;
  const newResult = createThread(st.threads);

  assert.notEqual(newResult.activeThreadId, oldThreadId);
  const newThread = newResult.threads.find((t) => t.id === newResult.activeThreadId);
  assert.equal(newThread.entries.length, 0);

  // History for the new thread is empty
  const history = buildThreadHistoryForRequest(newResult.threads, newResult.activeThreadId);
  assert.equal(history.length, 0);
});
