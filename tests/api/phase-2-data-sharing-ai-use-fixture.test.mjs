import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientEvaluateHandler from '../../server/routes/shared-report/[token]/evaluate.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

const EXPECTED_MEDIATION_PROVIDER = 'openai';
const EXPECTED_MEDIATION_MODEL = 'gpt-5.4';

process.env.MEDIATION_AI_PROVIDER = EXPECTED_MEDIATION_PROVIDER;
process.env.MEDIATION_AI_MODEL = EXPECTED_MEDIATION_MODEL;

function mockOpenAIV2Call(mockFn) {
  const previous = globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = mockFn;
  return () => {
    if (previous === undefined) {
      delete globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = previous;
    }
  };
}

function buildDataSharingOpenAIV2Mock() {
  return async ({ prompt, preferredModel }) => {
    const normalizedPrompt = String(prompt || '');
    const model = String(preferredModel || EXPECTED_MEDIATION_MODEL);
    const isLeakVerifierPrompt = normalizedPrompt.includes('strict security auditor');
    if (isLeakVerifierPrompt) {
      return {
        model,
        text: JSON.stringify({
          leak: false,
          reason: 'No confidential material appears in the response.',
        }),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }

    const isPassBPrompt =
      normalizedPrompt.includes('Required JSON schema (top-level evaluation keys required') ||
      normalizedPrompt.includes('INITIAL REPORT TO REFINE:');
    const isLaterBilateralRound =
      normalizedPrompt.includes('prior_bilateral_context') ||
      normalizedPrompt.includes('"current_bilateral_round_number": 2');

    if (!isPassBPrompt) {
      return {
        model,
        text: JSON.stringify({
          project_goal:
            'Agree a controlled customer-data and AI-use framework for a customer-specific deployment.',
          scope_deliverables: [
            'Defined customer data categories',
            'Permitted AI-use restrictions',
            'Retention, deletion, and security controls',
          ],
          timeline: {
            start: 'After signature and security review',
            duration: 'Customer-specific deployment term',
            milestones: ['Approved data mapping', 'Deployment evaluation window', 'Termination deletion workflow'],
          },
          constraints: [
            'No general or shared model training without written customer approval.',
            'Customer data use must be limited to the approved deployment purpose and security controls.',
          ],
          success_criteria_kpis: [
            'Approved data categories are documented before transfer.',
            'Retention, deletion, and access logging obligations are operationally enforceable.',
          ],
          vendor_preferences: [],
          assumptions: [
            'Both sides still want the AI deployment if the data-use guardrails are narrowed and auditable.',
          ],
          risks: [
            {
              risk: 'Broad product-improvement or model-training rights could expose confidential or sensitive customer data.',
              impact: 'high',
              likelihood: 'med',
            },
          ],
          open_questions: [
            'Which exact fields, tables, logs, and excluded sensitive data are approved for transfer?',
            'What approval is required before any model training, broader reuse, or external benchmarking?',
          ],
          missing_info: [
            'Exact in-scope data fields, AI-use approvals, and retention controls remain open.',
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

    if (!isLaterBilateralRound) {
      return {
        model,
        text: JSON.stringify({
          analysis_stage: 'mediation_review',
          fit_level: 'medium',
          confidence_0_1: 0.69,
          why: [
            'Recommendation: Proceed with conditions because both sides want the deployment, but the current draft still gives the vendor broad data access and AI-improvement rights without enough limits on training, retention, deletion, or sensitive-data handling.',
            'Where the Parties Align: They appear aligned on the value of a customer-specific AI deployment, the need for access controls, and the idea that some operational data may be required to configure and evaluate the system.',
            'Where the Deal Is Stuck: Product-improvement language remains too broad, general model training is not clearly prohibited, data categories are still underdefined, and security, subprocessor, retention, deletion, and output-rights obligations are not yet detailed enough for a high-trust data-sharing arrangement.',
            'Suggested Bridge: Limit use to customer-specific configuration and evaluation, require written approval before any broader model training or external reuse, define permitted data categories, and document confidentiality, access logging, retention, deletion, anonymisation, and subprocessor controls.',
            'Next Step: Confirm the approved data fields, the no-training-without-approval rule, the retention and deletion windows, the auditability expectations, and the treatment of outputs or derived artifacts after termination.',
          ],
          missing: [
            'Which exact data categories, fields, logs, and excluded sensitive data are in scope? — determines whether the permitted-use boundary is concrete.',
            'What approval is required before any general model training, broader reuse, or external benchmarking? — determines whether AI-use restrictions are enforceable.',
            'What retention, deletion, and backup-purge periods apply to raw data, derived artifacts, and logs? — determines whether data lifecycle obligations are operationally complete.',
          ],
          redactions: [],
        }),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }

    return {
      model,
      text: JSON.stringify({
        analysis_stage: 'mediation_review',
        fit_level: 'high',
        confidence_0_1: 0.83,
        why: [
          'Recommendation: Proceed with conditions because the later-round revisions have narrowed the deal from broad data access and product-improvement rights to a more controlled customer-specific data-use framework, with remaining issues concentrated in exact field mapping, audit evidence, and lifecycle detail.',
          'Where the Parties Align: They now appear aligned on customer-specific configuration and evaluation as the permitted use, no general or shared model training without written approval, defined data categories, confidentiality protection, deletion or return of customer data, access controls, logging, and a named subprocessor list.',
          'Where the Deal Is Stuck: The remaining friction is no longer whether the vendor may use the data generally. It is now about which exact CRM, support, and usage fields are approved, what retention periods apply to raw data, embeddings, logs, and backups, what audit evidence the customer receives, and how expanded AI use or subprocessor changes are approved.',
          'Suggested Bridge: Keep the controlled-use structure, attach an approved data-field schedule, define retention and deletion windows for raw data and derived artifacts, require customer approval before any broader training or reuse, and document access logging, subprocessor notice, and anonymisation thresholds for aggregated telemetry.',
          'Next Step: Finalize the field-level scope, backup retention period, audit-log deliverables, and approval path for any new model-training or external-reuse request so the parties can execute the narrowed framework cleanly.',
        ],
        missing: [
          'Which exact CRM fields, support-ticket elements, usage logs, embeddings, and excluded sensitive-data elements are approved for transfer? — determines whether the narrowed data scope is precise enough to implement.',
          'What retention, deletion, and backup-purge periods apply to raw data, derived artifacts, logs, and evaluation records after termination? — determines whether data lifecycle controls are complete.',
          'What audit evidence, subprocessor notice, and approval workflow apply before expanded AI use, new subprocessors, or broader reuse is allowed? — determines whether accountability remains customer-controlled.',
        ],
        redactions: [],
      }),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };
}

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

async function createSharedReportLink(cookie, comparisonId, recipientEmail) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie },
    body: {
      comparisonId,
      recipientEmail,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody();
}

async function saveRecipientDraft(token, recipientCookie, payload) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/draft`,
    headers: { cookie: recipientCookie },
    query: { token },
    body: payload,
  });
  const res = createMockRes();
  await sharedReportRecipientDraftHandler(req, res, token);
  return res;
}

async function evaluateRecipientDraft(token, recipientCookie) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    headers: { cookie: recipientCookie },
    query: { token, engine: 'v2' },
    body: {},
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

async function sendBackRecipientDraft(token, recipientCookie) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/send-back`,
    headers: { cookie: recipientCookie },
    query: { token },
    body: {},
  });
  const res = createMockRes();
  await sharedReportRecipientSendBackHandler(req, res, token);
  return res;
}

async function getSharedReportEvaluationDiagnostics(evaluationId) {
  const db = getDb();
  const rows = await db.execute(
    sql`select result_json
        from shared_report_evaluation_runs
        where id = ${evaluationId}
        limit 1`,
  );
  return rows.rows[0]?.result_json?.evaluation_diagnostics || {};
}

test('Phase 2: Data sharing / AI-use mediation (shared-report OpenAI/gpt-5.4 path)', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip();
    return;
  }

  await resetTables();
  await ensureMigrated();

  const proposerCookie = makeOwnerCookie('phase2_data_sharing_ai_use');
  const proposerEmail = 'phase2_data_sharing_ai_use_owner@example.com';
  const recipientEmail = 'privacy-team@example.com';
  const recipientCookie = makeRecipientCookie('phase2_data_sharing_ai_use', recipientEmail);
  const restoreOpenAICall = mockOpenAIV2Call(buildDataSharingOpenAIV2Mock());

  try {
    const comparison = await createComparison(proposerCookie, {
      title: 'Enterprise AI Deployment - Data Sharing and AI Use',
      docAText: `
        We propose an enterprise AI deployment for revenue analytics, forecasting support, and
        workflow recommendations. To configure and improve the system, we request access to CRM
        records, support tickets, product usage logs, account notes, and operational datasets.

        INITIAL DATA AND AI-USE POSITION:
        - Vendor may access customer data needed to configure, evaluate, and improve the AI system
        - Vendor may use customer data for benchmarking, model evaluation, and product improvement
        - Vendor may retain data while operationally useful for service support and model quality work
        - Aggregated or de-identified learnings may be reused across customers
        - Vendor may use subprocessors and cloud tools in the ordinary course of service delivery
        - Standard security practices will apply
      `,
      docBText: `
        We are interested in the deployment, but the data-sharing and AI-use rights are too broad.

        CUSTOMER CONCERNS:
        - Our datasets contain confidential business information and regulated customer information
        - We do not want our data used to train general or shared models without written approval
        - Data scope must be limited to defined categories and excluded sensitive fields
        - We need strict access controls, logging, and subprocessor transparency
        - Retention, deletion, and return obligations must be defined at termination
        - We need clarity on whether outputs, embeddings, derived insights, and telemetry can be reused
        - Aggregated or anonymised reuse must not identify us, our users, our customers, or our commercial terms
      `,
    });

    const comparisonId = comparison.id;
    assert.ok(comparisonId, 'Comparison ID should be returned');

    const linkRes = await createSharedReportLink(proposerCookie, comparisonId, recipientEmail);
    const token = linkRes.token;
    assert.ok(token, 'Token should be returned');

    const round1SaveRes = await saveRecipientDraft(token, recipientCookie, {
      shared_payload: {
        label: 'Customer Data Governance Response',
        text: `
          We want to move forward, but only with a controlled data-use arrangement.

          NON-NEGOTIABLES:
          - Customer data may not train general/shared models without prior written approval
          - Data access must be limited to approved categories, not open-ended platform access
          - Sensitive personal data, payment data, and privileged materials are out of scope unless separately approved
          - Vendor must maintain role-based access controls, audit logging, and a current subprocessor list
          - Customer data must be deleted or returned after termination within a defined period
          - Aggregated or anonymised reuse must not identify our company, users, customers, or pricing
          - Outputs and insights from our deployment must be licensed to us for internal business use
        `,
      },
      workflow_step: 1,
    });
    assert.equal(round1SaveRes.statusCode, 200, 'Round 1 draft save should succeed');

    const round1EvalRes = await evaluateRecipientDraft(token, recipientCookie);
    assert.equal(round1EvalRes.statusCode, 200, 'Round 1 evaluation should succeed');

    const round1Body = round1EvalRes.jsonBody();
    assert.ok(round1Body.evaluation_id, 'Round 1 evaluation ID should be present');
    const round1Diagnostics = await getSharedReportEvaluationDiagnostics(round1Body.evaluation_id);
    assert.equal(
      String(round1Diagnostics.provider || '').toLowerCase(),
      EXPECTED_MEDIATION_PROVIDER,
      'Round 1 shared-report evaluate should use OpenAI mediation provider (not Vertex default)',
    );
    assert.equal(
      String(round1Diagnostics.model || '').toLowerCase().includes(EXPECTED_MEDIATION_MODEL),
      true,
      `Round 1 shared-report evaluate should report ${EXPECTED_MEDIATION_MODEL} as mediation model`,
    );

    const round1Report = round1Body.evaluation?.public_report || {};
    const round1Summary = String(round1Report.executive_summary || round1Report.why || []).toLowerCase();
    const hasRound1DataUseSignals =
      round1Summary.includes('training') ||
      round1Summary.includes('retention') ||
      round1Summary.includes('deletion') ||
      round1Summary.includes('security') ||
      round1Summary.includes('subprocessor') ||
      round1Summary.includes('confidential');

    assert.equal(
      hasRound1DataUseSignals,
      true,
      'Phase 2: Round 1 should surface data-sharing and AI-use risk areas',
    );

    console.log('✅ Round 1 evaluation completed');

    const sendRes = await sendBackRecipientDraft(token, recipientCookie);
    assert.equal(sendRes.statusCode, 200, 'Round 1 send-back should succeed for invited recipient');
    const sendBody = sendRes.jsonBody() || {};
    assert.equal(
      String(sendBody.return_link?.recipient_email || ''),
      proposerEmail,
      'Round 2 return link should hand control back to the proposer email',
    );
    const round2Token = String(sendBody.return_link?.token || sendBody.returnLinkToken || '');
    assert.notEqual(round2Token, '', 'Round 2 token should be present after send-back');

    const round2SaveRes = await saveRecipientDraft(round2Token, proposerCookie, {
      shared_payload: {
        label: 'Vendor Revised Data Use Terms',
        text: `
          We revised the data-use structure to address your governance concerns.

          PERMITTED USE:
          - Customer data will be used only to configure, support, and evaluate your customer-specific deployment
          - No general/shared model training, external benchmarking, or broader product-improvement reuse without prior written approval

          DATA SCOPE:
          - In-scope categories: CRM opportunity metadata, support-ticket content, usage logs, and implementation event history
          - Excluded by default: payment data, raw call recordings, HR files, and special-category personal data

          CONFIDENTIALITY, SECURITY, AND ACCOUNTABILITY:
          - Role-based access controls with named personnel access approval
          - Access logging for administrative and support actions
          - Subprocessor list shared on request, with notice before material changes
          - Customer data encrypted in transit and at rest

          RETENTION AND DELETION:
          - Customer data returned or deleted within 30 days after termination
          - Backup purge completed within an additional controlled window

          AGGREGATION AND OUTPUTS:
          - Aggregated or anonymised telemetry may be reused only if it cannot identify your company, users, customers, or commercial terms
          - Outputs, insights, and reports are licensed to you for internal business use
        `,
      },
      workflow_step: 2,
    });
    assert.equal(round2SaveRes.statusCode, 200, 'Round 2 draft save should succeed');

    const round2EvalRes = await evaluateRecipientDraft(round2Token, proposerCookie);
    assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');

    const round2Body = round2EvalRes.jsonBody();
    assert.ok(round2Body.evaluation_id, 'Round 2 evaluation ID should be present');
    const round2Diagnostics = await getSharedReportEvaluationDiagnostics(round2Body.evaluation_id);
    assert.equal(
      String(round2Diagnostics.provider || '').toLowerCase(),
      EXPECTED_MEDIATION_PROVIDER,
      'Round 2 shared-report evaluate should use OpenAI mediation provider (not Vertex default)',
    );
    assert.equal(
      String(round2Diagnostics.model || '').toLowerCase().includes(EXPECTED_MEDIATION_MODEL),
      true,
      `Round 2 shared-report evaluate should report ${EXPECTED_MEDIATION_MODEL} as mediation model`,
    );

    const round2Report = round2Body.evaluation?.public_report || {};
    const round2Summary = String(round2Report.executive_summary || round2Report.why || []).toLowerCase();
    const round2Missing = round2Report.missing || round2Report.why || [];
    const round2MissingText = String(round2Missing).toLowerCase();
    const round2Text = JSON.stringify(round2Report || {}).toLowerCase();

    const hasMovementLanguage =
      round2Summary.includes('narrowed') ||
      round2Summary.includes('controlled') ||
      round2Summary.includes('customer-specific') ||
      round2Summary.includes('written approval') ||
      round2Summary.includes('no general') ||
      round2Summary.includes('conditional');
    assert.equal(
      hasMovementLanguage,
      true,
      'Phase 2: Later-round should detect movement from broad access toward a controlled data-use framework',
    );

    const hasStaleBroadQuestions =
      round2MissingText.includes('what data will be shared') ||
      round2MissingText.includes('can the vendor use the data') ||
      round2MissingText.includes('who owns the data') ||
      round2MissingText.includes('how long is the project');
    assert.equal(
      hasStaleBroadQuestions,
      false,
      'Phase 2: Later-round should not repeat unchanged broad data-use questions once detail is provided',
    );

    const hasSpecificLaterQuestions =
      round2MissingText.includes('exact crm fields') ||
      round2Text.includes('field-level scope') ||
      round2Text.includes('approved data-field schedule') ||
      round2Text.includes('backup retention') ||
      round2Text.includes('audit-log') ||
      round2Text.includes('subprocessor notice') ||
      round2Text.includes('approval path') ||
      round2Text.includes('external-reuse request');
    assert.equal(
      hasSpecificLaterQuestions,
      true,
      'Phase 2: Later-round should refresh to exact field scope, retention, audit, subprocessor, and approval questions',
    );

    const dataUseSignals = [
      round2Text.includes('permitted use') || round2Text.includes('customer-specific'),
      round2Text.includes('training') && round2Text.includes('written approval'),
      round2Text.includes('data categories') || round2Text.includes('fields'),
      round2Text.includes('confidential') || round2Text.includes('sensitive'),
      round2Text.includes('anonym') || round2Text.includes('aggregat'),
      round2Text.includes('retention'),
      round2Text.includes('delete') || round2Text.includes('return'),
      round2Text.includes('access control') || round2Text.includes('logging') || round2Text.includes('security'),
      round2Text.includes('audit'),
      round2Text.includes('subprocessor'),
      round2Text.includes('outputs') || round2Text.includes('insights') || round2Text.includes('derived'),
      round2Text.includes('misuse') || round2Text.includes('approval'),
    ];
    const matchedSignalCount = dataUseSignals.filter(Boolean).length;
    assert.equal(
      matchedSignalCount >= 8,
      true,
      `Phase 2: Later-round should center on genuine data-sharing / AI-use controls (matched ${matchedSignalCount} signals)`,
    );

    const hasControlledDataUseLandingZone =
      round2Summary.includes('customer-specific') ||
      round2Summary.includes('written approval') ||
      round2Summary.includes('retention') ||
      round2Summary.includes('deletion') ||
      round2Summary.includes('subprocessor') ||
      round2Summary.includes('audit');
    assert.equal(
      hasControlledDataUseLandingZone,
      true,
      'Phase 2: Later-round should land on controlled AI-use terms, not generic commercial language',
    );

    const hasWrongDealFraming =
      round2Text.includes('referral') ||
      round2Text.includes('channel partner') ||
      round2Text.includes('reseller') ||
      round2Text.includes('consulting engagement') ||
      round2Text.includes('statement of work') ||
      round2Text.includes('pilot') ||
      round2Text.includes('exclusive territory') ||
      round2Text.includes('simple software subscription');
    assert.equal(
      hasWrongDealFraming,
      false,
      'Phase 2: Output should not primarily frame the deal as referral, consulting, SaaS pilot, reseller, or generic subscription',
    );

    const round2Confidence = round2Report.confidence_score || round2Report.confidence_0_1;
    if (round2Confidence !== undefined) {
      const confidenceValue =
        typeof round2Confidence === 'string' ? parseFloat(round2Confidence) : round2Confidence;
      assert.ok(
        confidenceValue >= 0.4 || round2Report.recommendation !== 'unknown',
        'Phase 2: Later-round confidence should not collapse to unknown/0.2',
      );
    }

    console.log('✅ Phase 2 Data Sharing / AI-Use Fixture PASSED');
    console.log(`   Round 1 Evaluation ID: ${round1Body.evaluation_id}`);
    console.log(`   Round 2 Evaluation ID: ${round2Body.evaluation_id}`);
    console.log(`   Comparison ID: ${comparisonId}`);
    console.log('   Movement detected: broad access → controlled data-use framework');
    console.log(`   Data-use signals matched: ${matchedSignalCount}`);
  } catch (error) {
    console.error('Phase 2 data-sharing / AI-use fixture error:', error.message);
    throw error;
  } finally {
    restoreOpenAICall();
  }
});
