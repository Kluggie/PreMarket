/**
 * Tests verifying that Step 2 Suggested Prompts use one consistent threaded
 * action set across proposals, replies, and later rounds.
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

const FINAL_LABELS = [
  'Draft Response',
  'Negotiation Strategy',
  'Risks & Gaps',
  'Clarifying Questions',
  'Company Context',
];

const FINAL_INTENTS = [
  'draft_response',
  'negotiate',
  'risks',
  'clarifying_questions',
  'company_context',
];

test('Suggested Prompts contain the final neutral Step 2 action set and no old labels', () => {
  assert.deepEqual(DOCUMENT_COMPARISON_COACH_ACTIONS.map((action) => action.label), FINAL_LABELS);
  assert.deepEqual(DOCUMENT_COMPARISON_COACH_ACTIONS.map((action) => action.intent), FINAL_INTENTS);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.every((action) => action.mode === 'full'), true);

  const labels = DOCUMENT_COMPARISON_COACH_ACTIONS.map((action) => action.label);
  assert.equal(labels.includes('General Improvements'), false);
  assert.equal(labels.includes('Company Brief'), false);
  assert.equal(labels.includes('Draft My Reply'), false);
});

test('all visible Suggested Prompts build full coach requests without branching by round type', () => {
  for (const action of DOCUMENT_COMPARISON_COACH_ACTIONS) {
    const request = buildCoachActionRequest(action, { side: 'b', text: '', range: null });
    assert.ok(request, `buildCoachActionRequest should succeed for ${action.intent}`);
    assert.equal(request.mode, 'full');
    assert.equal(request.intent, action.intent);
    assert.equal(request.selectionText, undefined);
    assert.equal(request.selectionTarget, undefined);
  }
});

test('Draft Response starts a thread and appears first', () => {
  const firstAction = DOCUMENT_COMPARISON_COACH_ACTIONS[0];
  assert.equal(firstAction.label, 'Draft Response');
  assert.equal(firstAction.intent, 'draft_response');

  const st = appendUserEntry([], null, {
    content: firstAction.label,
    promptType: firstAction.intent,
    intent: firstAction.intent,
  });
  const thread = getActiveThread(st.threads, st.activeThreadId);
  assert.equal(thread.title, 'Draft Response');
  assert.equal(thread.entries.length, 1);
  assert.equal(thread.entries[0].promptType, 'draft_response');
});

test('Company Context is threaded like every other Step 2 prompt', () => {
  let st = appendUserEntry([], null, {
    content: 'Risks & Gaps',
    promptType: 'risks',
    intent: 'risks',
  });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'Risk analysis result',
    coachResult: null,
    coachResultHash: 'h1',
  });
  const threadId = st.activeThreadId;

  const st2 = appendUserEntry(st.threads, threadId, {
    content: 'Company Context',
    promptType: 'company_context',
    intent: 'company_context',
  });

  assert.equal(st2.activeThreadId, threadId);
  assert.equal(st2.threads[0].entries.length, 3);
  assert.equal(st2.threads[0].entries[2].role, 'user');
  assert.equal(st2.threads[0].entries[2].promptType, 'company_context');
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

test('thread history can include Company Context because it is a Step 2 suggestion', () => {
  let st = appendUserEntry([], null, { content: 'Company Context', promptType: 'company_context' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, {
    content: 'Company context answer',
    coachResultHash: 'h1',
  });

  const history = buildThreadHistoryForRequest(st.threads, st.activeThreadId);
  assert.equal(history.some((entry) => entry.promptType === 'company_context'), true);
});

test('starting a new thread resets to fresh state', () => {
  let st = appendUserEntry([], null, { content: 'Risks & Gaps', promptType: 'risks' });
  st = appendAssistantEntry(st.threads, st.activeThreadId, { content: 'risk answer', coachResultHash: 'h1' });

  const oldThreadId = st.activeThreadId;
  const newResult = createThread(st.threads);

  assert.notEqual(newResult.activeThreadId, oldThreadId);
  const newThread = newResult.threads.find((thread) => thread.id === newResult.activeThreadId);
  assert.equal(newThread.entries.length, 0);

  const history = buildThreadHistoryForRequest(newResult.threads, newResult.activeThreadId);
  assert.equal(history.length, 0);
});
