import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsCoachHandler from '../../server/routes/document-comparisons/[id]/coach.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();
if (!process.env.VERTEX_MOCK) {
  process.env.VERTEX_MOCK = '1';
}

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function createComparison(ownerCookie, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie: ownerCookie },
    body: {
      title: 'Coach Intent Test',
      doc_a_text: 'Confidential internal strategy and constraints.',
      doc_b_text: 'Shared obligations, milestones, and support scope.',
      createProposal: true,
      ...overrides,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison.id;
}

if (!hasDatabaseUrl()) {
  test('document comparison coach intents (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('rewrite_selection requires selection text and returns only replace_selection', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('coach_intent_rewrite_owner', 'coach-rewrite@example.com');
    const comparisonId = await createComparison(ownerCookie);

    const missingSelectionReq = createMockReq({
      method: 'POST',
      url: `/api/document-comparisons/${comparisonId}/coach`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        mode: 'selection',
        intent: 'rewrite_selection',
        selectionTarget: 'shared',
      },
    });
    const missingSelectionRes = createMockRes();
    await documentComparisonsCoachHandler(missingSelectionReq, missingSelectionRes, comparisonId);
    assert.equal(missingSelectionRes.statusCode, 400);

    const rewriteReq = createMockReq({
      method: 'POST',
      url: `/api/document-comparisons/${comparisonId}/coach`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        mode: 'selection',
        intent: 'rewrite_selection',
        selectionTarget: 'shared',
        selectionText: 'Shared obligations',
      },
    });
    const rewriteRes = createMockRes();
    await documentComparisonsCoachHandler(rewriteReq, rewriteRes, comparisonId);
    assert.equal(rewriteRes.statusCode, 200);
    assert.equal(rewriteRes.jsonBody().coach.suggestions.length, 1);
    assert.equal(rewriteRes.jsonBody().coach.suggestions[0].proposed_change.op, 'replace_selection');
    assert.equal(rewriteRes.jsonBody().coach.suggestions[0].proposed_change.target, 'doc_b');
    assert.equal(rewriteRes.jsonBody().coach.negotiation_moves.length, 0);
    assert.equal(rewriteRes.jsonBody().coach.questions.length, 0);
  });

  test('improve_shared returns only shared doc suggestions and no negotiation moves', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('coach_intent_improve_owner', 'coach-improve@example.com');
    const comparisonId = await createComparison(ownerCookie);
    const originalMockPayload = process.env.VERTEX_COACH_MOCK_RESPONSE;
    process.env.VERTEX_COACH_MOCK_RESPONSE = JSON.stringify({
      version: 'coach-v1',
      summary: {
        overall: 'Mixed output',
        top_priorities: ['One', 'Two'],
      },
      suggestions: [
        {
          id: 'conf_suggestion',
          scope: 'confidential',
          severity: 'warning',
          category: 'negotiation',
          title: 'Confidential note',
          rationale: 'Should be removed for improve_shared.',
          proposed_change: {
            target: 'doc_a',
            op: 'append',
            text: 'Confidential-only suggestion.',
          },
          evidence: {
            shared_quotes: [],
            confidential_quotes: [],
          },
        },
        {
          id: 'shared_suggestion',
          scope: 'shared',
          severity: 'info',
          category: 'wording',
          title: 'Shared clarity',
          rationale: 'Keep this shared-side suggestion.',
          proposed_change: {
            target: 'doc_b',
            op: 'append',
            text: 'Clarify the wording for the recipient-facing obligations.',
          },
          evidence: {
            shared_quotes: ['Shared obligations'],
            confidential_quotes: [],
          },
        },
      ],
      concerns: [],
      questions: [{ id: 'q1', to: 'self', text: 'Question', why: 'Why' }],
      negotiation_moves: [{ id: 'm1', title: 'Move', move: 'Move text', tradeoff: 'Tradeoff text' }],
    });

    try {
      const req = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'shared_only',
          intent: 'improve_shared',
        },
      });
      const res = createMockRes();
      await documentComparisonsCoachHandler(req, res, comparisonId);
      assert.equal(res.statusCode, 200);
      assert.equal(
        res
          .jsonBody()
          .coach.suggestions.every(
            (suggestion) => suggestion.proposed_change.target === 'doc_b' && suggestion.scope === 'shared',
          ),
        true,
      );
      assert.equal(res.jsonBody().coach.negotiation_moves.length, 0);
      assert.equal(res.jsonBody().coach.questions.length, 0);
      assert.equal(res.jsonBody().coach.concerns.length, 0);
    } finally {
      if (originalMockPayload === undefined) {
        delete process.env.VERTEX_COACH_MOCK_RESPONSE;
      } else {
        process.env.VERTEX_COACH_MOCK_RESPONSE = originalMockPayload;
      }
    }
  });

  test('risks intent returns concerns with severity even if model omits concerns', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('coach_intent_risks_owner', 'coach-risks@example.com');
    const comparisonId = await createComparison(ownerCookie);
    const originalMockPayload = process.env.VERTEX_COACH_MOCK_RESPONSE;
    process.env.VERTEX_COACH_MOCK_RESPONSE = JSON.stringify({
      version: 'coach-v1',
      summary: {
        overall: 'Risk scan',
        top_priorities: ['Investigate ambiguity'],
      },
      suggestions: [],
      concerns: [],
      questions: [],
      negotiation_moves: [],
    });

    try {
      const req = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'full',
          intent: 'risks',
        },
      });
      const res = createMockRes();
      await documentComparisonsCoachHandler(req, res, comparisonId);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody().coach.concerns.length > 0, true);
      assert.equal(
        res
          .jsonBody()
          .coach.concerns.every((concern) => ['warning', 'critical'].includes(String(concern.severity))),
        true,
      );
    } finally {
      if (originalMockPayload === undefined) {
        delete process.env.VERTEX_COACH_MOCK_RESPONSE;
      } else {
        process.env.VERTEX_COACH_MOCK_RESPONSE = originalMockPayload;
      }
    }
  });

  test('coach cache hash differs across intents for same content', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('coach_intent_cache_owner', 'coach-cache-intent@example.com');
    const comparisonId = await createComparison(ownerCookie);
    const originalMockPayload = process.env.VERTEX_COACH_MOCK_RESPONSE;
    process.env.VERTEX_COACH_MOCK_RESPONSE = JSON.stringify({
      version: 'coach-v1',
      summary: {
        overall: 'Stable payload',
        top_priorities: ['priority'],
      },
      suggestions: [
        {
          id: 's1',
          scope: 'shared',
          severity: 'info',
          category: 'wording',
          title: 'Stable suggestion',
          rationale: 'Deterministic output',
          proposed_change: {
            target: 'doc_b',
            op: 'append',
            text: 'Clarify the shared obligations section.',
          },
          evidence: {
            shared_quotes: ['Shared obligations'],
            confidential_quotes: [],
          },
        },
      ],
      concerns: [],
      questions: [],
      negotiation_moves: [],
    });

    try {
      const negotiateReq = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'full',
          intent: 'negotiate',
        },
      });
      const negotiateRes = createMockRes();
      await documentComparisonsCoachHandler(negotiateReq, negotiateRes, comparisonId);
      assert.equal(negotiateRes.statusCode, 200);
      const negotiateHash = negotiateRes.jsonBody().cache_hash;

      const risksReq = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'full',
          intent: 'risks',
        },
      });
      const risksRes = createMockRes();
      await documentComparisonsCoachHandler(risksReq, risksRes, comparisonId);
      assert.equal(risksRes.statusCode, 200);
      assert.equal(risksRes.jsonBody().cached, false);
      const risksHash = risksRes.jsonBody().cache_hash;
      assert.notEqual(risksHash, negotiateHash);

      const risksAgainReq = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'full',
          intent: 'risks',
        },
      });
      const risksAgainRes = createMockRes();
      await documentComparisonsCoachHandler(risksAgainReq, risksAgainRes, comparisonId);
      assert.equal(risksAgainRes.statusCode, 200);
      assert.equal(risksAgainRes.jsonBody().cached, true);
      assert.equal(risksAgainRes.jsonBody().cache_hash, risksHash);
    } finally {
      if (originalMockPayload === undefined) {
        delete process.env.VERTEX_COACH_MOCK_RESPONSE;
      } else {
        process.env.VERTEX_COACH_MOCK_RESPONSE = originalMockPayload;
      }
    }
  });
}

