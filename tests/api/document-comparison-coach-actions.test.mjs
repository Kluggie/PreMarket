import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoachActionRequest,
  canRunRewriteSelection,
  COMPANY_CONTEXT_COACH_ACTION,
  DOCUMENT_COMPARISON_COACH_ACTIONS,
  getCompanyContextInputBasis,
  hasCompanyContextInput,
} from '../../src/components/document-comparison/coachActions.js';

test('coach actions expose the final neutral Step 2 prompt set in order', () => {
  assert.equal(Array.isArray(DOCUMENT_COMPARISON_COACH_ACTIONS), true);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.length, 4);

  assert.deepEqual(DOCUMENT_COMPARISON_COACH_ACTIONS.map((action) => action.label), [
    'Draft Response',
    'Negotiation Strategy',
    'Risks & Gaps',
    'Clarifying Questions',
  ]);
  assert.deepEqual(DOCUMENT_COMPARISON_COACH_ACTIONS.map((action) => `${action.intent}:${action.mode}`), [
    'draft_response:full',
    'negotiate:full',
    'risks:full',
    'clarifying_questions:full',
  ]);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.some((action) => action.label === 'Company Context'), false);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.some((action) => action.label === 'General Improvements'), false);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.some((action) => action.label === 'Company Brief'), false);
  assert.equal(DOCUMENT_COMPARISON_COACH_ACTIONS.some((action) => action.label === 'Draft My Reply'), false);
});

test('Company Context is a separate company-section coach action', () => {
  assert.deepEqual(COMPANY_CONTEXT_COACH_ACTION, {
    id: 'company_context_full',
    label: 'Company Context',
    mode: 'full',
    intent: 'company_context',
  });

  const request = buildCoachActionRequest(COMPANY_CONTEXT_COACH_ACTION, { side: 'b', text: '', range: null });
  assert.equal(request.intent, 'company_context');
  assert.equal(request.mode, 'full');
  assert.equal(request.selectionText, undefined);
  assert.equal(request.selectionTarget, undefined);
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

test('Company Context helper requires company name or website and describes generated basis', () => {
  assert.equal(hasCompanyContextInput({ companyName: '', companyWebsite: '' }), false);
  assert.equal(hasCompanyContextInput({ companyName: 'Acme' }), true);
  assert.equal(hasCompanyContextInput({ companyWebsite: 'https://acme.example' }), true);

  assert.equal(
    getCompanyContextInputBasis({ companyName: 'Acme', companyWebsite: '' }),
    'Based on: company name only',
  );
  assert.equal(
    getCompanyContextInputBasis({ companyName: '', companyWebsite: 'https://acme.example' }),
    'Based on: website only · Website provided: https://acme.example',
  );
  assert.equal(
    getCompanyContextInputBasis({ companyName: 'Acme', companyWebsite: 'https://acme.example' }),
    'Based on: website + company name · Website provided: https://acme.example',
  );
});
