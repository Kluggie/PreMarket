import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoachActionRequest,
  canRunRewriteSelection,
  DOCUMENT_COMPARISON_COACH_ACTIONS,
} from '../../src/components/document-comparison/coachActions.js';

test('coach actions expose distinct intent/mode combinations including general improvements', () => {
  assert.equal(Array.isArray(DOCUMENT_COMPARISON_COACH_ACTIONS), true);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.length, 3);

  const pairs = DOCUMENT_COMPARISON_COACH_ACTIONS.map((action) => `${action.intent}:${action.mode}`);
  assert.deepEqual(pairs.sort(), [
    'general:full',
    'negotiate:full',
    'risks:full',
  ]);
});

test('rewrite selection gating requires non-empty selection text and valid range', () => {
  assert.equal(canRunRewriteSelection({ side: 'a', text: '', range: null }), false);
  assert.equal(canRunRewriteSelection({ side: 'a', text: 'hello', range: null }), false);
  assert.equal(canRunRewriteSelection({ side: 'a', text: 'hello', range: { from: 12, to: 12 } }), false);
  assert.equal(canRunRewriteSelection({ side: 'b', text: 'hello', range: { from: 12, to: 18 } }), true);
});

test('buildCoachActionRequest returns rewrite_selection payload with selection details', () => {
  const rewriteAction = {
    id: 'rewrite_selection',
    mode: 'selection',
    intent: 'rewrite_selection',
  };
  const selectionContext = {
    side: 'a',
    text: 'Selected confidential snippet',
    range: { from: 25, to: 52 },
  };
  const payload = buildCoachActionRequest(rewriteAction, selectionContext);

  assert.equal(payload.intent, 'rewrite_selection');
  assert.equal(payload.mode, 'selection');
  assert.equal(payload.selectionTarget, 'confidential');
  assert.equal(payload.selectionText, 'Selected confidential snippet');
  assert.deepEqual(payload.selectionRange, { from: 25, to: 52 });
});
