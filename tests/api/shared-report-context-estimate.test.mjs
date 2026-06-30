import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportsTokenHandler from '../../server/routes/shared-reports/[token].ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientEvaluateHandler from '../../server/routes/shared-report/[token]/evaluate.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
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

async function updateSharedReportLink(token, cookie, body = {}) {
  const req = createMockReq({
    method: 'PATCH',
    url: `/api/sharedReports/${token}`,
    query: { token },
    headers: { cookie },
    body,
  });
  const res = createMockRes();
  await sharedReportsTokenHandler(req, res, token);
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

async function evaluateRecipientDraft(token, body = {}, cookie = null, queryOverrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    query: { token, ...queryOverrides },
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

function mockVertexV2Call(mockFn) {
  const previous = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = mockFn;
  return () => {
    if (previous === undefined) {
      delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = previous;
    }
  };
}

if (!hasDatabaseUrl()) {
  test('shared-report context-estimate isolated e2e (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('shared-report context-estimate isolated e2e separates baseline from prior rounds and persists workspace/runtime estimates', async () => {
    await ensureMigrated();
    await resetTables();

    const seed = 'shared_report_context_estimate_isolated';
    const ownerCookie = makeOwnerCookie(seed);
    const recipientEmail = `${seed}_recipient@example.com`;
    const recipientCookie = makeRecipientCookie(seed, recipientEmail);

    const comparison = await createComparison(ownerCookie, {
      title: 'Shared Report Context Estimate Isolated Test',
      docAText: 'Internal proposer notes define fallback commercial guardrails and approval constraints.',
      docBText: 'Shared proposer draft sets phased scope, milestones, and delivery responsibilities.',
    });
    const link = await createSharedReportLink(ownerCookie, comparison.id, recipientEmail, {
      canView: true,
      canEdit: true,
      canReevaluate: true,
      canSendBack: true,
    });

    const initialWorkspaceRes = await getRecipientWorkspace(link.token, recipientCookie);
    assert.equal(initialWorkspaceRes.statusCode, 200);
    const initialContextEstimate = initialWorkspaceRes.jsonBody()?.review_context_estimate || {};
    assert.equal(typeof initialContextEstimate.totalEstimatedInputTokens, 'number');
    assert.equal(initialContextEstimate.initialProposalContextIncluded, true);
    assert.equal(initialContextEstimate.priorRoundsConsidered, 0);
    assert.equal(initialContextEstimate.includedPriorRounds, 0);
    assert.equal(initialContextEstimate.previousReviewsConsidered, 0);
    assert.equal(Array.isArray(initialContextEstimate.omittedDueToCapacity), true);

    const firstSaveRes = await saveRecipientDraft(link.token, {
      shared_payload: {
        label: 'Shared Information',
        text: 'Recipient round one adds implementation sequencing, dependency ownership, and rollout checkpoints.',
      },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Recipient round one internal note flags commercial approval boundaries.',
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(firstSaveRes.statusCode, 200);

    let passBCount = 0;
    const previousMediationProvider = process.env.MEDIATION_AI_PROVIDER;
    process.env.MEDIATION_AI_PROVIDER = 'vertex';
    const cleanup = mockVertexV2Call(async ({ prompt }) => {
      const normalizedPrompt = String(prompt || '');
      const isRefinementPrompt = normalizedPrompt.includes('INITIAL REPORT TO REFINE:');
      const isPassBPrompt =
        normalizedPrompt.includes('Required JSON schema (top-level evaluation keys required') ||
        isRefinementPrompt;
      const isLaterBilateralRound =
        normalizedPrompt.includes('prior_bilateral_context') ||
        normalizedPrompt.includes('"current_bilateral_round_number": 2');

      if (!isPassBPrompt) {
        return {
          model: 'gemini-2.5-flash-lite',
          text: JSON.stringify({
            project_goal: 'Agree a phased implementation rollout with bounded approval mechanics.',
            scope_deliverables: [
              'Phased rollout plan',
              'Named implementation checkpoints',
              'Documented approval path',
            ],
            timeline: {
              start: 'After approval mechanics are agreed',
              duration: 'Phased',
              milestones: ['Initial rollout checkpoint', 'Expansion decision'],
            },
            constraints: [
              'Expansion is conditional on checkpoint evidence.',
              'Final approval ownership must be explicit.',
            ],
            success_criteria_kpis: [
              'Checkpoint evidence is accepted by the named approval owner.',
              'Implementation sequencing is completed as agreed.',
            ],
            vendor_preferences: [],
            assumptions: [
              'The named stakeholders remain available for checkpoint review.',
            ],
            risks: [
              {
                risk: 'Unclear approval ownership could delay the next rollout phase.',
                impact: 'high',
                likelihood: 'med',
              },
            ],
            open_questions: [
              'Who owns final approval for each checkpoint?',
              'What evidence completes each checkpoint?',
            ],
            missing_info: [
              'Final approval ownership and checkpoint evidence remain open.',
            ],
            source_coverage: {
              has_scope: true,
              has_timeline: true,
              has_kpis: true,
              has_constraints: true,
              has_risks: true,
            },
          }),
          finishReason: 'STOP',
          httpStatus: 200,
        };
      }

      passBCount += 1;

      return {
        model: 'gemini-2.5-pro',
        text: JSON.stringify({
          analysis_stage: 'mediation_review',
          fit_level: 'medium',
          confidence_0_1: 0.66,
          why: [
            isLaterBilateralRound
              ? 'Recommendation: Proceed with conditions because implementation sequencing is now substantially aligned, while commercial acceptance criteria and final approval ownership still need closure. A bounded approval path would raise confidence without reopening the agreed rollout structure.'
              : 'Recommendation: Proceed with conditions because the phased rollout is workable, but implementation sequencing, commercial acceptance criteria, and final approval ownership still need clarification. Resolving those mechanics would preserve momentum without creating open-ended approval exposure.',
            'Where the Parties Align: Both sides support a phased rollout, named checkpoints, and a bounded approval process. They also appear to agree that the first phase should establish enough evidence to decide whether broader implementation work is justified.',
            'Where the Deal Is Stuck: Commercial acceptance criteria and final approval ownership remain unresolved. Those gaps determine when a checkpoint is complete, who can authorize the next phase, and whether either side can treat the rollout as ready for expansion.',
            'Suggested Bridge: Keep the phased rollout, name one approval owner for each checkpoint, and record the evidence required before the next phase begins. Optional reporting detail can remain outside the first phase unless both sides approve it through the agreed change process.',
            'Next Step: Hold a short closing session to settle checkpoint evidence, final approval ownership, and the escalation path before either side treats the rollout plan as final.',
          ],
          missing: [
            isLaterBilateralRound
              ? 'What commercial acceptance criteria trigger final sign-off? - determines whether the narrowed structure is executable without reopening scope.'
              : 'Who owns implementation sequencing? - determines whether launch accountability is contractable.',
          ],
          redactions: [],
          internal_analysis: {
            recommendation: 'Proceed with conditions',
            confidence: 0.66,
            decision_status: 'proceed_with_conditions',
            core_thesis: 'The phased rollout is workable once approval ownership and checkpoint evidence are explicit.',
            commercial_rationale: ['Both sides support a bounded rollout with named checkpoints.'],
            strongest_arguments_for: ['The rollout structure is concrete enough to close the remaining mechanics.'],
            strongest_arguments_against: ['Approval ownership and completion evidence remain unresolved.'],
            key_risks: ['An unresolved approval path could delay the next phase.'],
            hidden_assumptions: ['The named stakeholders remain available for review.'],
            unresolved_questions: ['Who owns final approval?'],
            negotiation_leverage: ['A phased rollout limits initial exposure.'],
            suggested_next_actions: ['Name the approval owner and checkpoint evidence.'],
            evidence_used: ['The materials describe a phased rollout and approval checkpoints.'],
            missing_information: ['Final approval ownership.'],
            tone_profile: 'constructive',
            output_mode: 'executive_memo',
          },
          narrative: {
            title: 'A workable rollout, once approval mechanics are explicit',
            sections: [
              {
                heading: isLaterBilateralRound
                  ? 'The rollout has moved closer since the prior round'
                  : 'The commercial direction is aligned',
                paragraphs: [
                  isLaterBilateralRound
                    ? 'Since the prior bilateral round, implementation sequencing is now substantially aligned and the parties have moved closer on the operating shape of the rollout. Both sides continue to support named checkpoints, which preserves a credible route to broader implementation without treating later expansion as already agreed.'
                    : 'Both sides support a phased rollout with named checkpoints, which creates a credible basis for continuing without treating later expansion as already agreed. The structure contains the first commitment while preserving a route to broader implementation if the evidence supports it.',
                  'The remaining work is concentrated in the approval mechanics rather than the overall commercial direction. That makes the negotiation closeable if the parties define completion evidence and decision authority.',
                  ...(isLaterBilateralRound
                    ? [
                        'The recommendation remains to proceed with conditions because the latest shared material resolves the earlier sequencing concern but does not yet close commercial acceptance criteria or final approval ownership. Confidence remains moderate for the same reason: the operating sequence is stronger, while the authority to approve completion is still not fully documented.',
                      ]
                    : []),
                ],
              },
              {
                heading: 'The final mechanics still matter',
                paragraphs: [
                  'Commercial acceptance criteria and final approval ownership remain open. Without those rules, the same checkpoint could be treated as complete by one side and incomplete by the other.',
                  'A practical bridge is to name the approval owner, record checkpoint evidence, and use a bounded escalation path before the next phase begins.',
                ],
              },
            ],
            closing: 'Settle checkpoint evidence, approval ownership, and escalation before finalizing the rollout plan.',
          },
          ...(isLaterBilateralRound
            ? {
                delta_summary:
                  'Since the prior bilateral round, implementation sequencing has narrowed materially, but commercial acceptance criteria remain open.',
                resolved_since_last_round: [
                  'Implementation sequencing is now substantially aligned.',
                ],
                remaining_deltas: [
                  'Commercial acceptance criteria still need final agreement.',
                  'Final approval ownership is clearer, but not yet fully locked.',
                ],
                new_open_issues: [
                  'Final approval ownership is now the most decision-relevant unresolved delta.',
                ],
                movement_direction: 'converging',
              }
            : {}),
        }),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    });

    try {
      const firstEvaluateRes = await evaluateRecipientDraft(link.token, {}, recipientCookie, { engine: 'v2' });
      assert.equal(firstEvaluateRes.statusCode, 200);

      const firstReport = firstEvaluateRes.jsonBody()?.evaluation?.evaluation_result?.report || {};
      assert.equal(firstReport.analysis_stage, 'mediation_review');
      assert.equal(firstReport.bilateral_round_number, 1);
      assert.equal(firstReport.delta_summary ?? null, null);

      const firstSendBackRes = await sendBackRecipientDraft(link.token, {}, recipientCookie);
      assert.equal(firstSendBackRes.statusCode, 200);
      const ownerReturnToken = String(firstSendBackRes.jsonBody()?.return_link?.token || '');
      assert.notEqual(ownerReturnToken, '');

      const ownerRoundSaveRes = await saveRecipientDraft(ownerReturnToken, {
        shared_payload: {
          label: 'Shared Information',
          text: 'Owner round two accepts the implementation sequencing and asks the recipient to confirm commercial acceptance criteria.',
        },
        recipient_confidential_payload: {
          label: 'Confidential Information',
          notes: 'Owner internal round two note keeps final approval bounded to named stakeholders.',
        },
        workflow_step: 2,
      }, ownerCookie);
      assert.equal(ownerRoundSaveRes.statusCode, 200);

      const ownerSendBackRes = await sendBackRecipientDraft(ownerReturnToken, {}, ownerCookie);
      assert.equal(ownerSendBackRes.statusCode, 200);
      const recipientRoundTwoToken = String(ownerSendBackRes.jsonBody()?.return_link?.token || '');
      assert.notEqual(recipientRoundTwoToken, '');

      const secondSaveRes = await saveRecipientDraft(recipientRoundTwoToken, {
        shared_payload: {
          label: 'Shared Information',
          text: 'Recipient round two confirms implementation sequencing and narrows the remaining issue to commercial acceptance criteria and final approval ownership.',
        },
        recipient_confidential_payload: {
          label: 'Confidential Information',
          notes: 'Recipient round two internal note confirms implementation sequencing is acceptable if sign-off stays bounded.',
        },
        workflow_step: 2,
      }, recipientCookie);
      assert.equal(secondSaveRes.statusCode, 200);

      const initialLaterRoundEvaluateRes = await evaluateRecipientDraft(
        recipientRoundTwoToken,
        {},
        recipientCookie,
        { engine: 'v2' },
      );
      assert.equal(initialLaterRoundEvaluateRes.statusCode, 200);

      const changedSecondSaveRes = await saveRecipientDraft(recipientRoundTwoToken, {
        shared_payload: {
          label: 'Shared Information',
          text: 'Recipient round two adds a follow-up change after the initial review and now needs the owner to enable one extra AI review.',
        },
        recipient_confidential_payload: {
          label: 'Confidential Information',
          notes: 'Recipient round two follow-up confidential note for extra-review gating coverage.',
        },
        workflow_step: 2,
      }, recipientCookie);
      assert.equal(changedSecondSaveRes.statusCode, 200);

      const disabledLaterRoundEvaluateRes = await evaluateRecipientDraft(
        recipientRoundTwoToken,
        {},
        recipientCookie,
        { engine: 'v2' },
      );
      assert.equal(disabledLaterRoundEvaluateRes.statusCode, 403);
      assert.equal(disabledLaterRoundEvaluateRes.jsonBody()?.error?.code, 'recipient_extra_ai_review_not_enabled');

      const enableLaterRoundReviewRes = await updateSharedReportLink(recipientRoundTwoToken, ownerCookie, {
        allowRecipientAiReview: true,
      });
      assert.equal(enableLaterRoundReviewRes.statusCode, 200);
      assert.equal(enableLaterRoundReviewRes.jsonBody()?.sharedReport?.allow_recipient_ai_review, true);

      const secondEvaluateRes = await evaluateRecipientDraft(
        recipientRoundTwoToken,
        {},
        recipientCookie,
        { engine: 'v2' },
      );
      assert.equal(secondEvaluateRes.statusCode, 200);

      const secondReport = secondEvaluateRes.jsonBody()?.evaluation?.evaluation_result?.report || {};
      assert.equal(secondReport.analysis_stage, 'mediation_review');
      assert.equal(secondReport.bilateral_round_number, 2);
      assert.equal(secondReport.movement_direction, 'converging');
      assert.match(secondReport.delta_summary, /Since the prior bilateral round/i);
      assert.equal(passBCount >= 2, true);

      const db = getDb();
      const evaluationRows = await db.execute(
        sql`select result_json
            from shared_report_evaluation_runs
            where proposal_id = ${comparison.proposal_id}
            order by created_at desc
            limit 1`,
      );
      const savedContextEstimate = evaluationRows.rows[0]?.result_json?.input_trace?.context_estimate || {};
      assert.equal(typeof savedContextEstimate.totalEstimatedInputTokens, 'number');
      assert.equal(savedContextEstimate.initialProposalContextIncluded, true);
      assert.equal(savedContextEstimate.priorRoundsConsidered > 0, true);
      assert.equal(savedContextEstimate.includedPriorRounds, savedContextEstimate.priorRoundsConsidered);
      assert.equal(savedContextEstimate.previousReviewsConsidered >= 1, true);
      assert.equal(typeof savedContextEstimate.retrievedChunkCount, 'number');
      assert.equal(Array.isArray(savedContextEstimate.omittedDueToCapacity), true);
      assert.equal(
        savedContextEstimate.omittedDueToCapacity.every((entry) => typeof entry === 'string' && entry.length > 0),
        true,
      );
      assert.notEqual(savedContextEstimate.capacityLabel, 'Very Light');

      const workspaceRes = await getRecipientWorkspace(recipientRoundTwoToken, recipientCookie);
      assert.equal(workspaceRes.statusCode, 200);
      const workspaceContextEstimate = workspaceRes.jsonBody()?.review_context_estimate || {};
      assert.equal(typeof workspaceContextEstimate.totalEstimatedInputTokens, 'number');
      assert.equal(workspaceContextEstimate.initialProposalContextIncluded, true);
      assert.equal(workspaceContextEstimate.priorRoundsConsidered > 0, true);
      assert.equal(workspaceContextEstimate.includedPriorRounds, workspaceContextEstimate.priorRoundsConsidered);
      assert.equal(workspaceContextEstimate.previousReviewsConsidered >= 1, true);
      assert.equal(typeof workspaceContextEstimate.retrievedChunkCount, 'number');
      assert.equal(Array.isArray(workspaceContextEstimate.omittedDueToCapacity), true);
      assert.equal(
        workspaceContextEstimate.omittedDueToCapacity.every((entry) => typeof entry === 'string' && entry.length > 0),
        true,
      );
      assert.equal(
        workspaceContextEstimate.totalEstimatedInputTokens >
          workspaceContextEstimate.currentBundleEstimatedTokens,
        true,
      );
    } finally {
      cleanup();
      if (previousMediationProvider === undefined) {
        delete process.env.MEDIATION_AI_PROVIDER;
      } else {
        process.env.MEDIATION_AI_PROVIDER = previousMediationProvider;
      }
    }
  });
}
