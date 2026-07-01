import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientEvaluateHandler from '../../server/routes/shared-report/[token]/evaluate.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function makeOwnerCookie(seed) {
  return makeSessionCookie({
    sub: `${seed}_owner`,
    email: `${seed}_owner@example.com`,
  });
}

function makeRecipientCookie(seed, email = `${seed}_recipient@example.com`) {
  return makeSessionCookie({
    sub: `${seed}_recipient`,
    email,
  });
}

async function createComparison(cookie, input) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie },
    body: {
      title: input.title,
      createProposal: true,
      docAText: input.docAText,
      docBText: input.docBText,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison;
}

async function createSharedReportLink(cookie, comparisonId, recipientEmail, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie },
    body: {
      comparisonId,
      recipientEmail,
      allowRecipientAiReview: true,
      ...overrides,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody();
}

async function saveRecipientDraft(token, body, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/draft`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientDraftHandler(req, res, token);
  return res;
}

async function evaluateRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

async function sendBackRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/send-back`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientSendBackHandler(req, res, token);
  return res;
}

async function getRecipientWorkspace(token, cookie = null) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/shared-report/${token}`,
    query: { token },
    headers: cookie ? { cookie } : {},
  });
  const res = createMockRes();
  await sharedReportRecipientTokenHandler(req, res, token);
  return res;
}


/**
 * Test that Round 4 does not reuse Round 2's AI evaluation result
 * 
 * This is a critical correctness bug: each round must generate its own
 * AI evaluation, not reuse the previous round's result.
 */
test('recipient AI review per-round scoping: Round 4 creates a new evaluation, not reusing Round 2', async () => {
  await ensureMigrated();
  await resetTables();

  const ownerSeed = 'round_scoping_test';
  const ownerCookie = makeOwnerCookie(ownerSeed);
  const ownerEmail = `${ownerSeed}_owner@example.com`;
  const recipientEmail = `${ownerSeed}_recipient@example.com`;
  const recipientCookie = makeRecipientCookie(ownerSeed, recipientEmail);

  // Create comparison and initial link
  const comparison = await createComparison(ownerCookie, {
    title: 'Round Scoping Test',
    docAText: 'Owner confidential baseline',
    docBText: 'Shared baseline for round scoping',
  });

  const initialLink = await createSharedReportLink(ownerCookie, comparison.id, recipientEmail, {
    canView: true,
    canEdit: true,
    canReevaluate: true,
    canSendBack: true,
    allowRecipientAiReview: true,
  });

  // Verify initial link doesn't have exchange_round set (defaults to 1 in send-back logic)
  const db = getDb();
  let linkRows = await db.execute(sql`
    select id, token, report_metadata 
    from shared_links 
    where token = ${initialLink.token}
  `);
  const round1LinkId = String(linkRows.rows[0]?.id || '');
  const round1Metadata = typeof linkRows.rows[0]?.report_metadata === 'object' 
    ? linkRows.rows[0].report_metadata 
    : JSON.parse(String(linkRows.rows[0]?.report_metadata || '{}'));
  // Initial link may not have exchange_round; it defaults to 1 in send-back logic
  assert.equal(
    Number(round1Metadata?.exchange_round || 1),
    1,
    'Initial link should default to exchange_round=1'
  );

  // === ROUND 2: Recipient runs first AI evaluation ===
  console.info('Starting Round 2 evaluation...');
  
  // Save draft for round 2
  const round2SaveRes = await saveRecipientDraft(initialLink.token, {
    shared_payload: { label: 'Shared', text: 'Recipient round 2 content' },
    recipient_confidential_payload: { label: 'Confidential', notes: 'Recipient round 2 notes' },
    workflow_step: 2,
  }, recipientCookie);
  assert.equal(round2SaveRes.statusCode, 200);

  // Set up mock evaluator for consistent results
  globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
    report: {
      recommendation: 'review',
      executive_summary: 'ROUND 2 EVALUATION - Original assessment for round 2',
      sections: [
        { heading: 'Summary', bullets: ['Round 2 specific content - Initial assessment'] }
      ],
    },
    evaluation_provider: 'test',
    similarity_score: 70,
  });

  // Run AI evaluation in round 2
  const round2EvalRes = await evaluateRecipientDraft(initialLink.token, {}, recipientCookie);
  
  assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');
  const round2EvalId = String(round2EvalRes.jsonBody()?.evaluation_id || '');
  assert.notEqual(round2EvalId, '', 'Round 2 should have an evaluation_id');
  
  const round2PublicReport = round2EvalRes.jsonBody()?.evaluation?.public_report || {};
  assert.match(
    String(round2PublicReport?.executive_summary || ''),
    /ROUND 2 EVALUATION/,
    'Round 2 report should have round 2 content'
  );

  // Verify round 2 evaluation created in database
  let evalRows = await db.execute(sql`
    select id, shared_link_id, status, result_json
    from shared_report_evaluation_runs
    where id = ${round2EvalId}
  `);
  assert.equal(evalRows.rows.length, 1, 'Round 2 evaluation should exist');
  assert.equal(String(evalRows.rows[0]?.status || ''), 'success');
  
  const round2EvalJson = typeof evalRows.rows[0]?.result_json === 'object'
    ? evalRows.rows[0].result_json
    : JSON.parse(String(evalRows.rows[0]?.result_json || '{}'));
  const round2ExchangeRound = Number(round2EvalJson?.input_trace?.exchange_round || 0);
  assert.equal(round2ExchangeRound, 1, 'Round 2 evaluation should store exchange_round=1 in result_json');

  // === SEND BACK TO CREATE ROUND 4 ===
  console.info('Sending back from Round 2 to create Round 4...');

  const round2SendRes = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);

  assert.equal(round2SendRes.statusCode, 200, 'Send-back should succeed');
  const round4Link = round2SendRes.jsonBody()?.return_link || {};
  const round4Token = String(round4Link?.token || '');
  assert.notEqual(round4Token, '', 'Send-back should create return link with token');

  // Verify round 4 link has different token, same proposalId, but different link ID
  linkRows = await db.execute(sql`
    select id, token, report_metadata, proposal_id
    from shared_links 
    where token = ${round4Token}
  `);
  assert.equal(linkRows.rows.length, 1, 'Round 4 link should exist');
  const round4LinkId = String(linkRows.rows[0]?.id || '');
  const round4Metadata = typeof linkRows.rows[0]?.report_metadata === 'object'
    ? linkRows.rows[0].report_metadata
    : JSON.parse(String(linkRows.rows[0]?.report_metadata || '{}'));
  
  assert.notEqual(round1LinkId, round4LinkId, 'Round 2 and Round 4 should have different link IDs');
  assert.equal(Number(round4Metadata?.exchange_round || 0), 2, 'Round 4 link should have exchange_round=2');

  // === ROUND 4: Owner runs AI evaluation ===
  console.info('Starting Round 4 evaluation...');

  // Save draft for round 4
  const round4SaveRes = await saveRecipientDraft(round4Token, {
    shared_payload: { label: 'Shared', text: 'Owner round 4 content with different context' },
    recipient_confidential_payload: { label: 'Confidential', notes: 'Owner round 4 notes' },
    workflow_step: 2,
  }, ownerCookie);
  assert.equal(round4SaveRes.statusCode, 200);

  // Update mock evaluator to return round 4 specific result
  globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
    report: {
      recommendation: 'proceed',
      executive_summary: 'ROUND 4 EVALUATION - New assessment for round 4 after mediation in round 2',
      sections: [
        { heading: 'Summary', bullets: ['Round 4 specific content - Follow-up assessment'] }
      ],
    },
    evaluation_provider: 'test',
    similarity_score: 45,
  });

  // Run AI evaluation in round 4
  const round4EvalRes = await evaluateRecipientDraft(round4Token, {}, ownerCookie);
  
  assert.equal(round4EvalRes.statusCode, 200, 'Round 4 evaluation should succeed');
  const round4EvalId = String(round4EvalRes.jsonBody()?.evaluation_id || '');
  assert.notEqual(round4EvalId, '', 'Round 4 should have an evaluation_id');
  assert.notEqual(round4EvalId, round2EvalId, 'Round 4 should have DIFFERENT evaluation_id from Round 2');

  const round4PublicReport = round4EvalRes.jsonBody()?.evaluation?.public_report || {};
  assert.match(
    String(round4PublicReport?.executive_summary || ''),
    /ROUND 4 EVALUATION/,
    'Round 4 report should have round 4 content, not round 2 content'
  );
  assert.doesNotMatch(
    String(round4PublicReport?.executive_summary || ''),
    /ROUND 2 EVALUATION/,
    'Round 4 report must NOT contain round 2 content'
  );

  // Verify round 4 evaluation created in database with correct round
  evalRows = await db.execute(sql`
    select id, shared_link_id, status, result_json
    from shared_report_evaluation_runs
    where id = ${round4EvalId}
  `);
  assert.equal(evalRows.rows.length, 1, 'Round 4 evaluation should exist');
  assert.equal(String(evalRows.rows[0]?.status || ''), 'success');
  
  const round4EvalJson = typeof evalRows.rows[0]?.result_json === 'object'
    ? evalRows.rows[0].result_json
    : JSON.parse(String(evalRows.rows[0]?.result_json || '{}'));
  const round4ExchangeRound = Number(round4EvalJson?.input_trace?.exchange_round || 0);
  assert.equal(round4ExchangeRound, 2, 'Round 4 evaluation should store exchange_round=2 in result_json');

  // === VERIFY WORKSPACE SHOWS CORRECT ROUND 4 RESULT ===
  console.info('Verifying workspace returns round 4 evaluation...');

  const round4WorkspaceRes = await getRecipientWorkspace(round4Token, ownerCookie);

  assert.equal(round4WorkspaceRes.statusCode, 200, 'Workspace should load');
  const workspaceLatestEval = round4WorkspaceRes.jsonBody()?.latestEvaluation || {};
  const workspaceLatestReport = round4WorkspaceRes.jsonBody()?.latestReport || {};

  assert.equal(
    String(workspaceLatestEval?.id || ''),
    round4EvalId,
    'Workspace should show Round 4 evaluation_id'
  );
  assert.match(
    String(workspaceLatestReport?.executive_summary || ''),
    /ROUND 4 EVALUATION/,
    'Workspace latestReport should have Round 4 content'
  );
  assert.doesNotMatch(
    String(workspaceLatestReport?.executive_summary || ''),
    /ROUND 2 EVALUATION/,
    'Workspace must NOT show Round 2 report for Round 4'
  );

  console.info('✓ Round 4 correctly generated new evaluation without reusing Round 2');
});

export { test };
