import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  evaluateWithVertexV2,
  validateResponseSchema,
  computeReportStyleSeed,
  selectReportStyle,
  assessReportQuality,
} from '../../server/_lib/vertex-evaluation-v2.ts';
import { buildStoredV2Evaluation } from '../../server/routes/document-comparisons/_helpers.ts';
import {
  PRE_SEND_REVIEW_STAGE,
  MEDIATION_REVIEW_STAGE,
  STAGE1_SHARED_INTAKE_STAGE,
} from '../../src/lib/opportunityReviewStage.js';

const require = createRequire(import.meta.url);
/** @type {{ cases: Array<any> }} */
const goldenFixtures = require('../fixtures/vertex-eval-v2-golden.json');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function setVertexV2MockSequence(sequence) {
  let index = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    const step = sequence[index];
    index += 1;
    if (!step) {
      throw new Error('No mocked Vertex response available');
    }
    if (step.throw) {
      throw step.throw;
    }
    return step.response;
  };
  return () => {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  };
}

// Final-eval response shape (Pass B result).
function validPayload(overrides = {}) {
  return {
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: 'medium',
    confidence_0_1: 0.73,
    why: ['Shared obligations align with internal constraints.'],
    missing: ['Clarify renewal terms in shared draft.'],
    redactions: ['Internal budget assumptions'],
    ...overrides,
  };
}

function validNaturalNarrative(overrides = {}) {
  return {
    title: 'A workable path, once the remaining mechanics are explicit',
    sections: [
      {
        heading: 'Why the commercial logic holds',
        paragraphs: [
          'The proposed dashboard engagement has a credible operating core because the materials identify the primary module, API integration work, milestones, and adoption expectations. Those facts give both sides a concrete basis for testing whether the planned rollout can create value.',
          'The commercial case is strongest where the named milestones connect the implementation effort to observable progress. That structure can contain initial exposure while preserving a route to broader adoption if the early dashboard and integration work perform as expected.',
        ],
      },
      {
        heading: 'What still needs to be settled',
        paragraphs: [
          'The remaining uncertainty sits around final approval ownership and the treatment of dependencies that could move the launch timetable. If those mechanics remain open, the same milestone may be treated as complete by one side and incomplete by the other.',
          'A practical route is to name the approval owner, document the escalation path, and tie any expansion to the existing milestones and adoption evidence. That keeps the current commitment bounded without inventing certainty about later phases.',
        ],
      },
    ],
    closing:
      'Record the approval owner, dependency escalation path, and milestone authority before either side treats the implementation plan as final.',
    ...overrides,
  };
}

function validInternalAnalysis(overrides = {}) {
  return {
    recommendation: 'Proceed with conditions',
    confidence: 0.73,
    decision_status: 'proceed_with_conditions',
    core_thesis: 'The engagement is workable once approval and dependency ownership are explicit.',
    commercial_rationale: ['Named dashboard milestones create a bounded implementation path.'],
    strongest_arguments_for: ['The scope and success measures are concrete.'],
    strongest_arguments_against: ['Approval ownership can still delay commitment.'],
    key_risks: ['An unresolved dependency could move the launch timetable.'],
    hidden_assumptions: ['The named stakeholders remain available for review.'],
    unresolved_questions: ['Who owns final approval?'],
    negotiation_leverage: ['A phased rollout limits initial exposure.'],
    suggested_next_actions: ['Name the approval owner and escalation path.'],
    evidence_used: ['The materials identify dashboard milestones and adoption targets.'],
    missing_information: ['Final approval ownership.'],
    tone_profile: 'constructive',
    output_mode: 'executive_memo',
    ...overrides,
  };
}

function validNegotiationAnalysis(overrides = {}) {
  return {
    proposing_party: {
      demands: ['Defined phase-one scope', 'Predictable approval path'],
      priorities: ['Timeline certainty', 'Clear acceptance criteria'],
      dealbreakers: [{ text: 'Undefined delivery ownership', basis: 'strongly_implied' }],
      flexibility: ['Optional enhancements can move to a later phase'],
    },
    counterparty: {
      demands: ['Commercial discipline', 'Named sign-off owner'],
      priorities: ['Budget control', 'Governance clarity'],
      dealbreakers: [{ text: 'Open-ended liability exposure', basis: 'stated' }],
      flexibility: ['Staged rollout may be acceptable if reporting stays intact'],
    },
    compatibility_assessment: 'compatible_with_adjustments',
    compatibility_rationale:
      'The parties appear compatible with adjustments if approval ownership and commercial guardrails are clarified.',
    bridgeability_notes: [
      'Clarify approval ownership before final commitment.',
      'Tie any expansion to milestone-based pricing and acceptance thresholds.',
    ],
    critical_incompatibilities: ['Approval ownership is still contested.'],
    ...overrides,
  };
}

// Full-coverage fact sheet (all source_coverage flags true).
// Pass A is expected to produce something in this shape for well-specified proposals.
function validFactSheetPayload(overrides = {}) {
  return {
    project_goal: 'Deliver analytics dashboard with defined KPIs and milestones.',
    scope_deliverables: ['Dashboard module', 'API integration', 'User acceptance testing'],
    timeline: { start: '2026-Q2', duration: '6 months', milestones: ['Alpha by Month 2', 'Beta by Month 4'] },
    constraints: ['Budget cap applies', 'Must use existing cloud infra'],
    success_criteria_kpis: ['Dashboard load time < 2s', 'User adoption >= 80% by Month 6'],
    vendor_preferences: [],
    assumptions: ['Stakeholders available for weekly reviews'],
    risks: [
      { risk: 'Scope creep', impact: 'med', likelihood: 'med' },
      { risk: 'Key-person dependency', impact: 'high', likelihood: 'low' },
    ],
    open_questions: [],
    missing_info: [],
    source_coverage: {
      has_scope: true,
      has_timeline: true,
      has_kpis: true,
      has_constraints: true,
      has_risks: true,
    },
    ...overrides,
  };
}

function validPreSendPayload(overrides = {}) {
  return {
    analysis_stage: PRE_SEND_REVIEW_STAGE,
    readiness_status: 'ready_with_clarifications',
    send_readiness_summary: 'The sender draft is workable, but ownership and implementation assumptions should be tightened before sharing.',
    missing_information: ['Who owns downstream remediation if integration work slips?'],
    ambiguous_terms: ['Success criteria for final acceptance remain implied rather than explicit.'],
    likely_recipient_questions: ['Which dependencies must be in place before delivery begins?'],
    likely_pushback_areas: ['Open-ended remediation responsibility is likely to draw pushback.'],
    commercial_risks: ['Budget boundaries are not yet tied to a defined change process.'],
    implementation_risks: ['Unclear integration ownership could slow approval and delivery.'],
    suggested_clarifications: ['Define acceptance criteria and assign remediation ownership before sending.'],
    ...overrides,
  };
}

function validStage1Payload(overrides = {}) {
  return {
    analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
    submission_summary:
      'The submitting party appears to be proposing a phased delivery engagement with milestone-based approvals and a bounded first phase.',
    scope_snapshot: [
      'A phased first phase is visible in the materials.',
      'Milestone approvals and timing assumptions are referenced.',
    ],
    unanswered_questions: [
      'What is the confirmed first-phase scope boundary?',
      'Who owns final approval at the end of the first milestone?',
    ],
    other_side_needed: [
      'Clarification on any scope corrections, approval requirements, or dependencies that may affect the first phase.',
    ],
    discussion_starting_points: [
      'Confirm the first-phase scope, milestone approvals, and the success measures that should guide the next exchange.',
    ],
    intake_status: 'awaiting_other_side_input',
    basis_note:
      'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
    ...overrides,
  };
}

function splitRenderedParagraphs(entries) {
  return entries
    .flatMap((entry) =>
      String(entry || '')
        .split(/\n{2,}/g)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean),
    );
}

function assertCleanRenderedEndings(entries, label) {
  for (const paragraph of splitRenderedParagraphs(entries)) {
    assert.match(paragraph, /[.!?]$/, `${label} paragraph must end cleanly: "${paragraph}"`);
    assert.doesNotMatch(
      paragraph,
      /(?:[:;,—-]|\b(?:and|or|but|because|if|then|with|for|to|of|in|on|by|versus|vs|than|around|about|under|over|through|including|depending|based))$/i,
      `${label} paragraph must not end on a dangling fragment: "${paragraph}"`,
    );
    assert.doesNotMatch(paragraph, /(?:\.\.\.|…)/, `${label} paragraph must not expose ellipsis fragments: "${paragraph}"`);
  }
}

function evaluateMediationWithVertexV2(input) {
  return evaluateWithVertexV2({
    analysisStage: MEDIATION_REVIEW_STAGE,
    ...input,
  });
}

function validateMediationResponse(value) {
  return validateResponseSchema(value, MEDIATION_REVIEW_STAGE);
}

test('validateResponseSchema accepts Stage 1 shared intake schema and rejects mediation fallback when stage is Stage 1', () => {
  const ok = validateResponseSchema(validStage1Payload(), STAGE1_SHARED_INTAKE_STAGE);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.normalized.analysis_stage, STAGE1_SHARED_INTAKE_STAGE);
  assert.equal('confidence_0_1' in ok.normalized, false);
  assert.equal('readiness_status' in ok.normalized, false);
  assert.equal('recommendation' in ok.normalized, false);

  const invalid = validateResponseSchema(validPayload(), STAGE1_SHARED_INTAKE_STAGE);
  assert.equal(invalid.ok, false);
});

test('validateResponseSchema accepts pre-send schema and rejects mediation fallback when stage is pre-send', () => {
  const ok = validateResponseSchema(validPreSendPayload(), PRE_SEND_REVIEW_STAGE);
  assert.equal(ok.ok, true);
  assert.equal(ok.normalized.analysis_stage, PRE_SEND_REVIEW_STAGE);

  const invalid = validateResponseSchema(validPayload(), PRE_SEND_REVIEW_STAGE);
  assert.equal(invalid.ok, false);
});

test('evaluateWithVertexV2 returns Stage 1 shared intake shape when analysisStage is stage1_shared_intake', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: JSON.stringify(validStage1Payload()),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared draft includes scope, milestones, and delivery notes for the counterparty.',
      confidentialText: 'Internal notes highlight unresolved ownership and timing assumptions.',
      analysisStage: STAGE1_SHARED_INTAKE_STAGE,
      requestId: 'test_stage1_shared_intake',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, STAGE1_SHARED_INTAKE_STAGE);
    assert.equal(typeof outcome.data.submission_summary, 'string');
    assert.equal(Array.isArray(outcome.data.scope_snapshot), true);
    assert.equal(Array.isArray(outcome.data.unanswered_questions), true);
    assert.equal(Array.isArray(outcome.data.other_side_needed), true);
    assert.equal(Array.isArray(outcome.data.discussion_starting_points), true);
    assert.equal(outcome.data.intake_status, 'awaiting_other_side_input');
    assert.match(outcome.data.basis_note, /preliminary summary/i);
    assert.equal('fit_level' in outcome.data, false);
    assert.equal('confidence_0_1' in outcome.data, false);
    assert.equal('readiness_status' in outcome.data, false);
    assert.equal('send_readiness_summary' in outcome.data, false);
  } finally {
    cleanup();
  }
});

test('evaluateWithVertexV2 returns pre-send review shape when analysisStage is pre_send_review', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: JSON.stringify(validPreSendPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared draft includes scope, milestones, and delivery notes for the counterparty.',
      confidentialText: 'Internal sender notes highlight unresolved ownership and commercial assumptions.',
      analysisStage: PRE_SEND_REVIEW_STAGE,
      requestId: 'test_pre_send_review',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, PRE_SEND_REVIEW_STAGE);
    assert.equal(outcome.data.readiness_status, 'ready_with_clarifications');
    assert.equal(Array.isArray(outcome.data.likely_recipient_questions), true);
    assert.equal('fit_level' in outcome.data, false);
    assert.equal('confidence_0_1' in outcome.data, false);
    assert.equal('why' in outcome.data, false);
  } finally {
    cleanup();
  }
});

test('evaluateWithVertexV2 Stage 1 fallback stays neutral when model output is invalid', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(validFactSheetPayload({
          project_goal: 'Launch a phased customer-support automation pilot.',
          scope_deliverables: ['Pilot scope', 'Milestone approvals'],
          open_questions: ['Who owns final pilot approval?'],
          missing_info: ['What measurable success criteria define the pilot outcome?'],
          source_coverage: {
            has_scope: true,
            has_timeline: true,
            has_kpis: false,
            has_constraints: true,
            has_risks: false,
          },
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'still not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared materials describe a phased automation pilot with milestone approvals.',
      confidentialText: 'Internal notes say pilot success criteria and approval ownership still need clarification.',
      analysisStage: STAGE1_SHARED_INTAKE_STAGE,
      requestId: 'test_stage1_shared_intake_fallback',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, STAGE1_SHARED_INTAKE_STAGE);
    assert.equal(outcome.data.intake_status, 'awaiting_other_side_input');
    assert.match(outcome.data.basis_note, /preliminary summary/i);
    assert.equal(outcome.data.unanswered_questions.length >= 1, true);
    assert.equal(outcome.data.other_side_needed.length >= 1, true);
    assert.equal('confidence_0_1' in outcome.data, false);
    assert.equal('readiness_status' in outcome.data, false);
    assert.equal('send_readiness_summary' in outcome.data, false);
  } finally {
    cleanup();
  }
});

test('evaluateWithVertexV2 fallback keeps plausible pre-send drafts at ready_with_clarifications when the record is incomplete but still usable', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(validFactSheetPayload({
          constraints: ['Fixed-price pilot requested', 'Must use existing cloud infra'],
          success_criteria_kpis: [],
          risks: [],
          open_questions: ['Who owns documentation remediation before implementation starts?'],
          missing_info: [
            'What measurable acceptance criteria define completion?',
            'What pricing model applies after the pilot?',
          ],
          source_coverage: {
            has_scope: true,
            has_timeline: true,
            has_kpis: false,
            has_constraints: true,
            has_risks: false,
          },
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'still not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared pilot draft includes a proposed rollout window, existing platform notes, and a request for a fixed-price pilot.',
      confidentialText: 'Internal notes say documentation quality is uneven and remediation ownership is still unresolved.',
      analysisStage: PRE_SEND_REVIEW_STAGE,
      requestId: 'test_pre_send_fallback_ready_with_clarifications',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, PRE_SEND_REVIEW_STAGE);
    assert.equal(outcome.data.readiness_status, 'ready_with_clarifications');
    assert.match(outcome.data.send_readiness_summary, /credible brief for vendor discussion/i);
    assert.match(outcome.data.send_readiness_summary, /limited clarifications/i);
    assert.match(outcome.data.send_readiness_summary, /fixed-price/i);
  } finally {
    cleanup();
  }
});

test('evaluateWithVertexV2 fallback can treat a strong proposer-only draft as ready_to_send without inventing medium-severity problems', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(validFactSheetPayload({
          project_goal: 'Launch a six-week customer-support automation pilot with named integrations, measurable acceptance criteria, and a documented handover.',
          scope_deliverables: [
            'Zendesk integration',
            'Intent library for the agreed support flows',
            'Acceptance test pack and handover notes',
          ],
          timeline: {
            start: '2026-07-07',
            duration: '6 weeks',
            milestones: ['Kickoff in week 1', 'Pilot review in week 4', 'Acceptance sign-off in week 6'],
          },
          constraints: ['Use existing Zendesk and HubSpot environments', 'Weekly steering review with the sender team'],
          success_criteria_kpis: [
            'Automation handles at least 40% of agreed ticket categories',
            'Intent accuracy stays at or above 85% during the pilot',
            'Acceptance sign-off occurs within 5 business days of the final test pack',
          ],
          risks: [
            { risk: 'Support handover timing needs to stay aligned with pilot sign-off', impact: 'med', likelihood: 'low' },
          ],
          open_questions: ['Confirm the preferred weekly steering-call slot.'],
          missing_info: [],
          source_coverage: {
            has_scope: true,
            has_timeline: true,
            has_kpis: true,
            has_constraints: true,
            has_risks: true,
          },
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'still not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared draft defines the pilot scope, delivery milestones, acceptance metrics, and handover expectations.',
      confidentialText: 'Internal notes confirm only minor scheduling coordination remains before sharing.',
      analysisStage: PRE_SEND_REVIEW_STAGE,
      requestId: 'test_pre_send_fallback_ready_to_send',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, PRE_SEND_REVIEW_STAGE);
    assert.equal(outcome.data.readiness_status, 'ready_to_send');
    assert.match(outcome.data.send_readiness_summary, /strong early-stage commercial brief/i);
    assert.match(outcome.data.send_readiness_summary, /ready to share/i);
    assert.match(outcome.data.send_readiness_summary, /minor clarifications/i);
    assert.doesNotMatch(outcome.data.send_readiness_summary, /not yet strong enough/i);
    assert.deepEqual(outcome.data.missing_information, []);
    assert.equal(outcome.data.likely_recipient_questions.includes('Confirm the preferred weekly steering-call slot.'), true);
  } finally {
    cleanup();
  }
});

test('evaluateWithVertexV2 fallback still keeps genuinely weak proposer-only drafts at not_ready_to_send', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(validFactSheetPayload({
          project_goal: 'Explore an AI uplift initiative.',
          scope_deliverables: [],
          timeline: { start: null, duration: null, milestones: [] },
          constraints: ['Budget TBD'],
          success_criteria_kpis: [],
          risks: [],
          assumptions: [],
          open_questions: [
            'Who would own implementation?',
            'Which systems are in scope?',
            'What budget is available?',
          ],
          missing_info: [
            'What is the actual pilot scope?',
            'What measurable success criteria define completion?',
            'What timeline or milestone structure applies?',
            'Who owns integrations, approvals, and dependencies?',
          ],
          source_coverage: {
            has_scope: false,
            has_timeline: false,
            has_kpis: false,
            has_constraints: false,
            has_risks: false,
          },
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.5-pro',
        text: 'still not valid json',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared draft says the team wants to explore an AI initiative but leaves scope, budget, and timeline open.',
      confidentialText: 'Internal notes say ownership and system coverage are still undecided.',
      analysisStage: PRE_SEND_REVIEW_STAGE,
      requestId: 'test_pre_send_fallback_not_ready',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, PRE_SEND_REVIEW_STAGE);
    assert.equal(outcome.data.readiness_status, 'not_ready_to_send');
    assert.match(outcome.data.send_readiness_summary, /not yet ready/i);
    assert.equal(outcome.data.missing_information.length >= 3, true);
  } finally {
    cleanup();
  }
});

test('evaluateWithVertexV2 rejects omitted analysisStage instead of defaulting to mediation', async () => {
  await assert.rejects(
    () =>
      evaluateWithVertexV2({
        sharedText: 'Shared draft content for omission test.',
        confidentialText: 'Confidential draft content for omission test.',
      }),
    /analysisStage/i,
  );
});

test('evaluateWithVertexV2 adds prior bilateral context to later mediation rounds without changing the mediation schema', async () => {
  const prompts = [];
  const previous = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    prompts.push(String(prompt || ''));
    return {
      model: 'gemini-2.5-pro',
      text: JSON.stringify(validPayload({
        why: [
          'Executive Summary: The structure is workable if the remaining governance and sequencing issues are resolved.',
          'Decision Assessment: Risk Summary: The main risk is still approval ownership and launch sequencing.\n\nKey Strengths: Commercial intent and phased scope remain usable.',
          'Negotiation Insights: Likely priorities: both sides appear to want movement, but they still differ on governance and launch ownership.\n\nPossible concessions: optional features can move behind the first milestone.\n\nStructural tensions: the main tension is launch speed versus approval control.',
          'Leverage Signals: Leverage signal: both sides have reasons to keep momentum, but neither wants to absorb open-ended approval risk.',
          'Potential Deal Structures: Option A — phase the launch with explicit governance gates.\n\nOption B — tie expansion to milestone sign-off.\n\nOption C — narrow scope now and reopen optional work later.',
          'Decision Readiness: Decision status: Proceed with conditions. Governance ownership still needs final agreement.\n\nWhat must be agreed now vs later: lock governance ownership now and defer optional enhancements.\n\nWhat would change the verdict: a cleaner approval path would raise confidence.',
          'Recommended Path: Recommended path: resolve governance ownership in the next round.',
        ],
        missing: [
          'Who owns final approval sequencing? — determines whether launch accountability is contractable.',
          'What launch dependencies must be signed off before work starts? — determines whether the current timeline is realistic.',
        ],
      })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared round-two draft with phased scope, launch timing, and governance discussion.',
      confidentialText: 'Private notes say pricing flexibility exists if governance risk is contained.',
      requestId: 'test_later_mediation_round',
      mediationRoundContext: {
        current_bilateral_round_number: 2,
        prior_bilateral_round_id: 'eval_prev_1',
        prior_bilateral_round_number: 1,
        prior_primary_insight: 'The first bilateral review found the structure workable but governance ownership remained open.',
        prior_missing: [
          'Who owns final approval sequencing?',
          'What launch dependencies must be signed off before work starts?',
        ],
        prior_bridgeability_notes: ['Clarify governance ownership before final commitment.'],
      },
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.data.analysis_stage, MEDIATION_REVIEW_STAGE);

    const mediationPrompt = prompts.find((entry) => entry.includes('prior_bilateral_context'));
    assert.equal(Boolean(mediationPrompt), true);
    assert.match(mediationPrompt, /delta_summary/);
    assert.match(mediationPrompt, /progress across rounds/i);
    assert.match(mediationPrompt, /output shape/i);
  } finally {
    if (previous === undefined) {
      delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = previous;
    }
  }
});

// Returns the mock vertex-response wrapper for a Pass A (fact sheet) success.
function factSheetResponse(overrides = {}) {
  return {
    model: 'gemini-2.0-flash-001',
    text: JSON.stringify(validFactSheetPayload(overrides)),
    finishReason: 'STOP',
    httpStatus: 200,
  };
}

// ─── Schema validation (no Vertex calls) ─────────────────────────────────────

test('validateResponseSchema accepts strict small schema and rejects missing keys', () => {
  const good = validateMediationResponse(validPayload());
  assert.equal(good.ok, true);

  const withNegotiation = validateMediationResponse(
    validPayload({
      negotiation_analysis: validNegotiationAnalysis(),
    }),
  );
  assert.equal(withNegotiation.ok, true);
  if (withNegotiation.ok) {
    assert.equal(withNegotiation.normalized.negotiation_analysis?.compatibility_assessment, 'compatible_with_adjustments');
    assert.equal(
      withNegotiation.normalized.negotiation_analysis?.counterparty.dealbreakers[0]?.basis,
      'stated',
    );
  }

  const missing = validateMediationResponse({
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: 'medium',
    confidence_0_1: 0.6,
    why: ['ok'],
    missing: [],
  });
  assert.equal(missing.ok, false);
  assert.equal(Array.isArray(missing.missingKeys), true);
  assert.equal(missing.missingKeys.includes('redactions'), true);
});

test('validateResponseSchema requires analysis_stage for all supported stages', () => {
  const mediationMissingStage = validateMediationResponse({
    fit_level: 'medium',
    confidence_0_1: 0.6,
    why: ['ok'],
    missing: ['Clarify pricing guardrails.'],
    redactions: [],
  });
  assert.equal(mediationMissingStage.ok, false);
  assert.equal(mediationMissingStage.missingKeys.includes('analysis_stage'), true);

  const stage1MissingStage = validateResponseSchema(
    {
      submission_summary: 'The current submission outlines a phased rollout.',
      scope_snapshot: ['Phased rollout'],
      unanswered_questions: ['Who owns final approval?'],
      other_side_needed: ['Clarification on any approval constraints.'],
      discussion_starting_points: ['Confirm the approval path.'],
      intake_status: 'awaiting_other_side_input',
      basis_note:
        'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
    },
    STAGE1_SHARED_INTAKE_STAGE,
  );
  assert.equal(stage1MissingStage.ok, false);
  assert.equal(stage1MissingStage.missingKeys.includes('analysis_stage'), true);

  const preSendMissingStage = validateResponseSchema(
    {
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary: 'Needs a clearer scope definition before sharing.',
      missing_information: ['Define the final acceptance gate.'],
      ambiguous_terms: [],
      likely_recipient_questions: [],
      likely_pushback_areas: [],
      commercial_risks: [],
      implementation_risks: [],
      suggested_clarifications: [],
    },
    PRE_SEND_REVIEW_STAGE,
  );
  assert.equal(preSendMissingStage.ok, false);
  assert.equal(preSendMissingStage.missingKeys.includes('analysis_stage'), true);
});

test('validateResponseSchema preserves a clear hardline incompatibility when supported by concrete blocking evidence', () => {
  const result = validateMediationResponse(
    validPayload({
      negotiation_analysis: validNegotiationAnalysis({
        compatibility_assessment: 'fundamentally_incompatible',
        compatibility_rationale:
          'The parties appear fundamentally incompatible because each side is treating liability allocation as non-negotiable.',
        critical_incompatibilities: ['Each side requires the other to absorb open-ended liability exposure.'],
      }),
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.normalized.negotiation_analysis?.compatibility_assessment, 'fundamentally_incompatible');
  assert.equal(
    result.normalized.negotiation_analysis?.critical_incompatibilities[0],
    'Each side requires the other to absorb open-ended liability exposure.',
  );
});

test('validateResponseSchema downgrades unsupported hard-incompatibility claims to missing-information uncertainty', () => {
  const result = validateMediationResponse(
    validPayload({
      negotiation_analysis: {
        proposing_party: {
          demands: ['Clarify launch sequencing'],
          priorities: ['Timeline certainty'],
          dealbreakers: [{ text: 'Timeline certainty', basis: 'not_clearly_established' }],
          flexibility: ['Milestone packaging may be adjustable'],
        },
        counterparty: {
          demands: ['Clarify governance ownership'],
          priorities: ['Governance clarity'],
          dealbreakers: [{ text: 'Governance clarity', basis: 'not_clearly_established' }],
          flexibility: ['Reporting cadence may be adjustable'],
        },
        compatibility_assessment: 'fundamentally_incompatible',
        compatibility_rationale: 'The parties are fundamentally incompatible.',
        bridgeability_notes: ['Clarify sequencing and governance ownership.'],
        critical_incompatibilities: [],
      },
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.normalized.negotiation_analysis?.compatibility_assessment,
    'uncertain_due_to_missing_information',
  );
  assert.match(
    result.normalized.negotiation_analysis?.compatibility_rationale || '',
    /not yet clear|requires clarification/i,
  );
});

// ─── Core evaluation flow (updated for 2-pass) ───────────────────────────────
// In 2-pass mode each evaluateWithVertexV2 call makes:
//   Call 1 = Pass A (fact sheet extraction)
//   Call 2+ = Pass B (final evaluation, with retry on transient errors)
// Sequences must supply Pass A response first.

test('v2 accepts valid JSON response', async () => {
  const cleanup = setVertexV2MockSequence([
    // Pass A — full-coverage fact sheet so no clamps fire
    { response: factSheetResponse() },
    // Pass B — final eval
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'high',
          confidence_0_1: 0.9,
          internal_analysis: validInternalAnalysis({
            recommendation: 'Move toward final agreement',
            confidence: 0.9,
            decision_status: 'ready_to_finalize',
            core_thesis: 'The defined dashboard engagement supports a clean commitment.',
            strongest_case_against: [],
            key_risks: [],
            unresolved_questions: [],
            missing_information: [],
            suggested_next_actions: ['Carry the agreed mechanics into final documentation.'],
          }),
          missing: [],
          redactions: [],
          narrative: validNaturalNarrative({
            title: 'The dashboard engagement is ready for final documentation',
            sections: [
              {
                heading: 'Why the deal now holds together',
                paragraphs: [
                  'The dashboard engagement is sufficiently bounded for a clean commitment because the materials define the core module, API integration, rollout milestones, budget constraint, and adoption target. Those elements connect the work, timetable, and expected outcome without requiring either side to infer the basic commercial model.',
                  'The staged milestones give both parties a practical governance mechanism. They allow progress to be reviewed against the alpha and beta dates while keeping the broader six-month adoption objective visible.',
                ],
              },
              {
                heading: 'What to preserve in final documentation',
                paragraphs: [
                  'The final documents should retain the named dashboard scope, integration responsibility, milestone dates, infrastructure constraint, and user-adoption measure. Preserving those mechanics matters more than adding generic drafting volume.',
                  'The remaining work is documentation rather than commercial redesign. The current evidence supports moving forward while ensuring the agreed milestones and responsibility boundaries are carried accurately into the final terms.',
                ],
              },
            ],
            closing:
              'Carry the defined dashboard scope, milestone dates, infrastructure constraint, and adoption target into final documentation and approval.',
          }),
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared commitments include milestones and support obligations.',
      confidentialText: 'Internal constraints include delivery limits and governance controls.',
      requestId: 'req-valid-1',
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // Full-coverage fact sheet → no clamps → high / 0.9 preserved
    assert.equal(outcome.data.fit_level, 'high');
    assert.equal(outcome.data.confidence_0_1, 0.9);
    assert.equal(outcome.data.internal_analysis?.decision_status, 'ready_to_finalize');
    assert.equal(outcome.data.internal_analysis?.confidence, 0.9);
    assert.equal(typeof outcome.data.internal_analysis?.core_thesis, 'string');
    assert.equal(outcome.data.narrative?.title, 'The dashboard engagement is ready for final documentation');
    assert.equal(outcome._internal?.narrative_validation?.renderer_path, 'narrative');
    assert.equal(outcome._internal?.retrieval?.retrieval_strategy, 'primary_context_fallback_v1');
    assert.equal(
      outcome._internal?.retrieval?.retrieval_warnings.includes(
        'structured_source_provenance_unavailable',
      ),
      true,
    );
    assert.equal(
      /pause|reject|do not proceed/i.test(
        JSON.stringify(outcome.data.narrative),
      ),
      false,
    );
    assert.equal(outcome.attempt_count, 1);
    assert.equal(typeof outcome.model, 'string');
  } finally {
    cleanup();
  }
});

test('post-calibration removes a narrative that contradicts the final conditional decision', async () => {
  const factSheet = validFactSheetPayload({
    project_goal: 'Test a SaaS referral and implementation partnership.',
    scope_deliverables: ['Non-exclusive six-month pilot', 'Referral relationship', 'Implementation support'],
    timeline: { start: null, duration: 'six months', milestones: [] },
    constraints: [],
    success_criteria_kpis: [],
    risks: [],
    open_questions: ['When is commission earned?', 'How long does client protection last?'],
    missing_info: ['Commission trigger is undefined.', 'Client-protection period is undefined.'],
    source_coverage: {
      has_scope: true,
      has_timeline: true,
      has_kpis: false,
      has_constraints: false,
      has_risks: false,
    },
  });
  const positiveWhy = [
    'Recommendation: Approve the agreement and move directly to signature because the parties share a clear commercial objective and have enough common ground to launch the partnership immediately. The remaining mechanics can be resolved after approval without delaying the pilot.',
    'Where the Parties Align: Both sides support a non-exclusive six-month pilot, referral commission, implementation support, and a path to broader cooperation if the partnership produces qualified customers. That alignment creates a credible reason to test the channel before either side grants wider rights.',
    'Where the Deal Is Stuck: The materials do not yet define when commission is earned, how introduced accounts are registered, how long client protection lasts, or what continuing support would justify recurring revenue share. Those issues affect the value and control each side receives.',
    'Suggested Bridge: Use registered referrals, a defined client-protection window, separate implementation fees, and recurring revenue share only while documented ongoing support continues. Semi-exclusivity should depend on a measurable performance threshold after the pilot.',
    'Next Step: Approve the final agreement and schedule the pilot launch while the parties complete the remaining attribution wording. The commercial intent is strong enough that these drafting details should not delay signature.',
  ];
  const positiveNarrative = {
    title: 'This partnership is ready to finalize now',
    sections: [
      {
        heading: 'Why the parties should sign',
        paragraphs: [
          'The arrangement is ready to proceed because both sides support a six-month pilot, referral economics, and implementation support. Those elements form a coherent commercial package and appear to justify immediate approval.',
          'The remaining attribution and support questions are unresolved, but they can be treated as routine drafting matters after signature. The current proposal therefore supports a clean commitment rather than a conditional path.',
        ],
      },
      {
        heading: 'The final route',
        paragraphs: [
          'The parties should move directly to signature and use the pilot period to settle any residual questions. Waiting for more detail would add process without changing the basic commercial logic.',
          'This is ready to finalize, with only administrative wording left to complete. The current materials provide enough certainty for immediate commitment despite the open commission and client-protection mechanics.',
        ],
      },
    ],
    closing: 'Approve the final agreement and schedule the pilot launch.',
  };
  const passB = validPayload({
    fit_level: 'high',
    confidence_0_1: 0.94,
    why: positiveWhy,
    missing: [
      'When is referral commission earned and paid? — determines the economic trigger.',
      'How long does client protection last? — determines whether introductions remain attributable.',
    ],
    internal_analysis: validInternalAnalysis({
      recommendation: 'Finalize the agreement now',
      confidence: 0.94,
      decision_status: 'ready_to_finalize',
      core_thesis: 'The partnership is ready for immediate commitment.',
      suggested_next_actions: ['Sign and launch.'],
    }),
    narrative: positiveNarrative,
  });

  let callCount = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(callCount === 1 ? factSheet : passB),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText:
        'Both parties support a non-exclusive six-month SaaS referral pilot with implementation support.',
      confidentialText:
        'Private constraints exist but must not be exposed in the shared mediation report.',
      requestId: 'req-calibrated-narrative-consistency',
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.data.fit_level, 'medium');
    assert.equal(outcome.data.internal_analysis?.decision_status, 'proceed_with_conditions');
    assert.equal(outcome.data.narrative, undefined);
    assert.equal(outcome._internal?.narrative_validation?.renderer_path, 'fallback');
    assert.equal(
      outcome._internal?.caps_applied.includes('discard_invalid_or_decision_inconsistent_narrative'),
      true,
    );

    const stored = buildStoredV2Evaluation(outcome);
    const visibleText = stored.report.presentation_sections
      .flatMap((section) => [...(section.paragraphs || []), ...(section.bullets || [])])
      .join(' ');
    assert.equal(stored.report.renderer_path, 'fallback');
    assert.equal(stored.report.narrative_valid, false);
    assert.equal(
      /ready to finalize|approve the final agreement|move directly to signature|ready to sign/i.test(visibleText),
      false,
      visibleText,
    );
    assert.match(visibleText, /conditions|open|resolve|clarif|before/i);
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('post-calibration revalidates and removes an unqualified viable narrative after a not-viable downgrade', async () => {
  const factSheet = validFactSheetPayload({
    project_goal: 'Explore a possible commercial partnership.',
    scope_deliverables: [],
    timeline: { start: null, duration: null, milestones: [] },
    constraints: [],
    success_criteria_kpis: [],
    assumptions: [],
    risks: [],
    open_questions: [
      'What commercial structure is being proposed?',
      'What obligations would each party accept?',
      'How would value and risk be allocated?',
    ],
    missing_info: [
      'The proposed scope is not established.',
      'The timing and decision process are not established.',
      'The commercial terms and success measures are not established.',
    ],
    source_coverage: {
      has_scope: false,
      has_timeline: false,
      has_kpis: false,
      has_constraints: false,
      has_risks: false,
    },
  });
  const viableNarrative = validNaturalNarrative({
    title: 'A workable and plausible partnership landing zone',
    sections: [
      {
        heading: 'Why a bridge remains realistic',
        paragraphs: [
          'This still looks like a plausible and bridgeable partnership with a workable path to agreement. The parties can use a bounded pilot as a realistic landing zone while the unresolved commercial mechanics are developed.',
          'A pilot would let both sides move forward now and use operating experience to settle the remaining economics. That approach treats the current gaps as manageable conditions rather than reasons to reject the opportunity.',
        ],
      },
      {
        heading: 'How to move ahead',
        paragraphs: [
          'The parties should proceed with a short pilot and record broad responsibilities before launch. They can defer the detailed value allocation and success measures until the relationship has produced initial evidence.',
          'The practical next move is to approve the pilot concept and begin planning. The unresolved scope, timing, economics, and risk allocation can then be completed alongside implementation.',
        ],
      },
    ],
    closing:
      'Approve a bounded pilot now and complete the remaining commercial mechanics as the partnership develops.',
  });
  const passB = validPayload({
    fit_level: 'high',
    confidence_0_1: 0.9,
    why: [
      'Recommendation: Proceed with a pilot now because the opportunity appears workable despite the limited record.',
      'Where the Parties Align: Both sides appear interested in exploring a commercial relationship.',
      'Where the Deal Is Stuck: Scope, timing, economics, success measures, and risk allocation remain unresolved.',
      'Suggested Bridge: Use a bounded pilot while the parties develop the missing terms.',
      'Next Step: Approve the pilot concept and begin planning.',
    ],
    missing: [
      'What commercial structure is being proposed?',
      'What obligations would each party accept?',
      'How would value and risk be allocated?',
    ],
    internal_analysis: validInternalAnalysis({
      recommendation: 'Proceed with a pilot',
      confidence: 0.9,
      decision_status: 'ready_to_finalize',
      core_thesis: 'A pilot provides a workable path despite the thin source record.',
      suggested_next_actions: ['Approve the pilot concept.'],
    }),
    narrative: viableNarrative,
  });

  let callCount = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(callCount === 1 ? factSheet : passB),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText:
        'The parties have expressed interest in exploring a possible commercial relationship.',
      confidentialText:
        'Private material must not be exposed in the shared mediation report.',
      requestId: 'req-low-calibrated-narrative-consistency',
      maxQualityRepairCalls: 0,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.data.fit_level, 'low');
    assert.equal(outcome.data.internal_analysis?.decision_status, 'not_viable');
    assert.equal(outcome.data.narrative, undefined);
    assert.equal(outcome._internal?.narrative_validation?.renderer_path, 'fallback');
    assert.equal(
      outcome._internal?.caps_applied.includes('discard_invalid_or_decision_inconsistent_narrative'),
      true,
    );

    const stored = buildStoredV2Evaluation(outcome);
    const visibleText = JSON.stringify(stored.report.presentation_sections);
    assert.equal(stored.report.renderer_path, 'fallback');
    assert.equal(stored.report.narrative_valid, false);
    assert.doesNotMatch(
      visibleText,
      /\bworkable\b|\bplausible\b|\bbridgeable\b|\brealistic landing zone\b/i,
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('v2 parses fenced JSON and preamble text', async () => {
  const body = `Model output follows:\n\`\`\`json\n${JSON.stringify(validPayload())}\n\`\`\`\nDone`;
  const cleanup = setVertexV2MockSequence([
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: body,
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared draft references support scope and acceptance criteria.',
      confidentialText: 'Internal constraints include legal and operational requirements.',
      requestId: 'req-fence-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.data.fit_level, 'medium');
  } finally {
    cleanup();
  }
});

test('v2 preserves optional negotiation analysis metadata', async () => {
  const cleanup = setVertexV2MockSequence([
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validPayload({
            negotiation_analysis: validNegotiationAnalysis({
              compatibility_assessment: 'uncertain_due_to_missing_information',
              proposing_party: {
                demands: ['Named scope boundary'],
                priorities: ['Timeline certainty'],
                dealbreakers: [{ text: 'Scope drift', basis: 'strongly_implied' }],
                flexibility: ['Payment sequencing may be adjustable'],
              },
            }),
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covers scope, timing, and phased commercial terms.',
      confidentialText: 'Internal notes emphasise scope control and sequencing flexibility.',
      requestId: 'req-negotiation-analysis-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(
      outcome.data.negotiation_analysis?.compatibility_assessment,
      'uncertain_due_to_missing_information',
    );
    assert.equal(
      outcome.data.negotiation_analysis?.proposing_party.dealbreakers[0]?.basis,
      'strongly_implied',
    );
    assert.deepEqual(
      outcome.data.negotiation_analysis?.bridgeability_notes,
      validNegotiationAnalysis({
        compatibility_assessment: 'uncertain_due_to_missing_information',
        proposing_party: {
          demands: ['Named scope boundary'],
          priorities: ['Timeline certainty'],
          dealbreakers: [{ text: 'Scope drift', basis: 'strongly_implied' }],
          flexibility: ['Payment sequencing may be adjustable'],
        },
      }).bridgeability_notes,
    );
  } finally {
    cleanup();
  }
});

test('v2 coerces legacy structured schema into small schema', async () => {
  const legacy = {
    summary: {
      fit_level: 'high',
      top_fit_reasons: [{ text: 'Strong scope alignment in shared terms.' }],
      top_blockers: [{ text: 'Renewal language is incomplete.' }],
    },
    quality: {
      confidence_overall: 0.81,
    },
    flags: [
      {
        detail_level: 'redacted',
        title: 'Internal cost constraints',
      },
    ],
  };

  const cleanup = setVertexV2MockSequence([
    // Full-coverage fact sheet so high/0.81 is not clamped
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(legacy),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared terms include scope, milestones, and support.',
      confidentialText: 'Internal terms include budget constraints and legal caveats.',
      requestId: 'req-legacy-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.data.fit_level, 'high');
    assert.equal(outcome.data.confidence_0_1, 0.81);
    assert.equal(outcome.data.why.length > 0, true);
    assert.equal(outcome.data.missing.length > 0, true);
    assert.equal(outcome.data.redactions.length > 0, true);
  } finally {
    cleanup();
  }
});

test('v2 retries once (tight mode) then falls back with truncated_output', async () => {
  const truncatedResponse = {
    model: 'gemini-2.0-flash-001',
    text: '{"fit_level":"high","confidence_0_1":0.8,"why":["partial"]',
    finishReason: 'MAX_TOKENS',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1 — truncated → triggers tight retry
    { response: truncatedResponse },
    // Pass B attempt 2 (tight mode) — truncated again → fallback
    { response: truncatedResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared text has enough content for evaluation reliability checks.',
      confidentialText: 'Confidential text has enough content for internal alignment checks.',
      requestId: 'req-trunc-1',
    });
    // New behaviour: truncation falls back to a safe partial result (never ok:false).
    assert.equal(outcome.ok, true, 'truncated output must return ok:true via fallback');
    if (!outcome.ok) return;
    assert.equal(outcome.attempt_count, 2, 'should have attempted twice');
    assert.equal(outcome._internal.failure_kind, 'truncated_output', 'failure_kind must record truncated_output');
    assert.ok(
      Array.isArray(outcome._internal.warnings) && outcome._internal.warnings.length > 0,
      '_internal.warnings must be non-empty for fallback path',
    );
    assert.ok(
      outcome._internal.warnings.some((w) => w.includes('truncated')),
      '_internal.warnings must contain a truncated-output warning key',
    );
    assert.equal(outcome._internal.fallback_mode, 'salvaged_memo', 'full fact-sheet fallback should be classified as salvageable');
    assert.equal(outcome.data.fit_level, 'medium', 'salvaged fallback should surface a coherent conditional fit level');
    assert.ok(outcome.data.confidence_0_1 > 0.2, 'salvaged fallback confidence must not stay at the incomplete 0.2 floor');
    assert.ok(
      outcome.data.why.some((entry) => entry.includes('Mediation Summary') || entry.includes('Recommended path:')),
      'salvaged fallback should return a substantive negotiator memo',
    );
    assert.ok(Array.isArray(outcome.data.missing) && outcome.data.missing.length >= 3,
      'fallback must provide at least 3 missing items');
    assertCleanRenderedEndings(outcome.data.why, 'fallback why[]');
    assertCleanRenderedEndings(outcome.data.missing, 'fallback missing[]');
  } finally {
    cleanup();
  }
});

test('v2 retries transient vertex_http_error once and then succeeds', async () => {
  const transientError = Object.assign(new Error('upstream 502'), {
    code: 'vertex_request_failed',
    statusCode: 502,
    extra: {
      upstreamStatus: 502,
      upstreamMessage: 'Bad gateway',
    },
  });

  const cleanup = setVertexV2MockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1 — transient error
    { throw: transientError },
    // Pass B attempt 2 — success
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.61 })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared text contains enough detail for retry resilience validation.',
      confidentialText: 'Confidential text contains enough detail for retry resilience validation.',
      requestId: 'req-http-retry-success-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.attempt_count, 2);
    assert.equal(outcome.data.fit_level, 'medium');
  } finally {
    cleanup();
  }
});

test('v2 falls back after persistent vertex_http_error (retries exhausted)', async () => {
  const transientError = Object.assign(new Error('upstream 502'), {
    code: 'vertex_request_failed',
    statusCode: 502,
    extra: {
      upstreamStatus: 502,
      upstreamMessage: 'Bad gateway',
    },
  });

  const cleanup = setVertexV2MockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1 — transient error
    { throw: transientError },
    // Pass B attempt 2 — transient error again → retries exhausted → fallback
    { throw: transientError },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared text contains enough detail for persistent upstream failure checks.',
      confidentialText: 'Confidential text contains enough detail for persistent upstream failure checks.',
      requestId: 'req-http-retry-fail-1',
    });
    // New behaviour: network failures after retries use fallback (never ok:false).
    assert.equal(outcome.ok, true, 'network error fallback must return ok:true');
    if (!outcome.ok) return;
    assert.equal(outcome.attempt_count, 2, 'should have attempted twice');
    assert.equal(outcome._internal.failure_kind, 'vertex_http_error', 'failure_kind must record vertex_http_error');
    assert.ok(
      Array.isArray(outcome._internal.warnings) && outcome._internal.warnings.length > 0,
      '_internal.warnings must be non-empty for fallback path',
    );
    assert.ok(
      outcome._internal.warnings.some((w) => w.includes('request_failed')),
      '_internal.warnings must contain a vertex_request_failed warning key',
    );
    assert.equal(outcome._internal.fallback_mode, 'salvaged_memo', 'full fact-sheet fallback should be salvageable');
    assert.equal(outcome.data.fit_level, 'medium', 'salvaged fallback should not surface as unknown');
    assert.ok(outcome.data.confidence_0_1 > 0.2, 'salvaged fallback confidence must be above the incomplete floor');
  } finally {
    cleanup();
  }
});

test('v2 falls back on persistent json_parse_error (tight retry also fails)', async () => {
  const badJsonResponse = {
    model: 'gemini-2.0-flash-001',
    text: 'Not JSON at all',
    finishReason: 'STOP',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1 — invalid JSON → triggers tight retry
    { response: badJsonResponse },
    // Pass B attempt 2 (tight mode) — still invalid JSON → fallback
    { response: badJsonResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared content for parse test.',
      confidentialText: 'Confidential content for parse test.',
      requestId: 'req-json-err-1',
    });
    // New behaviour: parse errors fall back to a safe partial result (never ok:false).
    assert.equal(outcome.ok, true, 'json parse error must return ok:true via fallback');
    if (!outcome.ok) return;
    assert.equal(outcome._internal.failure_kind, 'json_parse_error', 'failure_kind must record json_parse_error');
    assert.ok(
      Array.isArray(outcome._internal.warnings) && outcome._internal.warnings.length > 0,
      '_internal.warnings must be non-empty for fallback path',
    );
    assert.ok(
      outcome._internal.warnings.some((w) => w.includes('invalid_response') || w.includes('fallback')),
      '_internal.warnings must contain an invalid_response fallback key',
    );
    assert.equal(outcome._internal.fallback_mode, 'salvaged_memo', 'full fact-sheet parse fallback should be salvageable');
    assert.equal(outcome.data.fit_level, 'medium', 'salvaged parse fallback should not surface as unknown');
    assert.ok(outcome.data.confidence_0_1 > 0.2, 'salvaged parse fallback confidence must be above 0.2');
  } finally {
    cleanup();
  }
});

test('v2 true incomplete fallback stays minimal and explicitly incomplete when extraction is too thin', async () => {
  const badJsonResponse = {
    model: 'gemini-2.0-flash-001',
    text: 'still not valid json',
    finishReason: 'STOP',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    // Pass A — extraction fails immediately, leaving only the thin fallback fact sheet
    { throw: new Error('pass-a-failed') },
    // Pass B attempt 1 — invalid JSON
    { response: badJsonResponse },
    // Pass B attempt 2 — invalid JSON again → fallback used
    { response: badJsonResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Short shared text.',
      confidentialText: 'Short confidential text.',
      requestId: 'req-incomplete-fallback-1',
    });

    assert.equal(outcome.ok, true, 'fallback must still return ok:true');
    if (!outcome.ok) return;

    assert.equal(outcome._internal.fallback_mode, 'incomplete', 'thin fallback must be marked as incomplete');
    assert.equal(outcome.data.fit_level, 'unknown', 'true incomplete fallback must remain unknown');
    assert.equal(outcome.data.confidence_0_1, 0.2, 'true incomplete fallback confidence must remain at 0.2');

    const whyText = outcome.data.why.join('\n');
    assert.equal(whyText.includes('could not be completed'), true, 'incomplete fallback must clearly say generation did not complete');
    assert.equal(whyText.includes('source record is too thin'), false, 'generation failure must not be misreported as thin source material');
    assert.equal(whyText.includes('collect the missing information below'), false, 'generation failure must not tell users to add information that may already exist');
    assert.deepEqual(outcome.data.missing, [], 'failed generation must not invent generic project-delivery questions');
    assert.equal(whyText.includes('Conditionally viable'), false, 'incomplete fallback must not be rewritten into a substantive memo');
    assert.equal(whyText.includes('Paths to agreement'), false, 'incomplete fallback must not contain bridge-to-agreement memo content');
  } finally {
    cleanup();
  }
});

test('v2 detects planted confidential token leak: ok:true suppressed, canary absent', async () => {
  const planted = 'CONFIDENTIAL_PRICE_12345';
  const cleanup = setVertexV2MockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B returns a response leaking the token
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validPayload({
            why: [`Pricing appears aligned at ${planted}.`],
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared draft discusses commercial structure in general terms.',
      confidentialText: `Internal planning includes token ${planted} that must never leak.`,
      requestId: 'req-leak-1',
      enforceLeakGuard: true,
    });
    // Policy: leak detected → ok:true suppressed output, never a hard failure.
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.data.fit_level, 'unknown', 'fit_level must be unknown (suppressed)');
    assert.equal(outcome.data.confidence_0_1, 0, 'confidence_0_1 must be 0 (suppressed)');
    const warnings = outcome._internal?.warnings ?? [];
    assert.ok(
      warnings.includes('confidential_leak_detected_output_suppressed'),
      `Expected confidential_leak_detected_output_suppressed in warnings; got: ${JSON.stringify(warnings)}`,
    );
    assert.equal(outcome._internal?.failure_kind, 'confidential_leak_detected');
    // Canary must never appear in the output
    assert.equal(JSON.stringify(outcome.data).includes(planted), false);
  } finally {
    cleanup();
  }
});

test('v2 leak guard scans negotiation analysis metadata as well as why/missing/redactions', async () => {
  const planted = 'CONFIDENTIAL_BRIDGE_NOTE_99887';
  const cleanup = setVertexV2MockSequence([
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validPayload({
            negotiation_analysis: validNegotiationAnalysis({
              compatibility_rationale: `The path to agreement depends on ${planted}.`,
            }),
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared draft outlines scope, pricing posture, and milestone timing.',
      confidentialText: `Private negotiation note ${planted} must never leak.`,
      requestId: 'req-leak-negotiation-analysis-1',
      enforceLeakGuard: true,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.data.fit_level, 'unknown');
    assert.equal(outcome.data.confidence_0_1, 0);
    assert.equal(JSON.stringify(outcome.data).includes(planted), false);
    assert.ok(
      (outcome._internal?.warnings || []).includes('confidential_leak_detected_output_suppressed'),
      'new negotiation analysis fields must not bypass the leak guard',
    );
  } finally {
    cleanup();
  }
});

// ─── Sanity checks: prompt structure (updated for 2-pass) ────────────────────

test('sanity: prompt encodes anti-alignment guardrail and proposal-quality objective', async () => {
  let passAPrompt = '';
  let passBPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) {
      passAPrompt = prompt;
      // Return a valid fact sheet so Pass A completes successfully
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Capture the Pass B prompt (call #2); refinement/regen calls are #3+
    if (callCount === 2) passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.6 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal text: deliver analytics dashboard by Q3.',
      confidentialText: 'Confidential: budget is $200k, team of 5 engineers.',
      requestId: 'req-sanity-prompt-1',
    });

    assert.ok(callCount >= 2, 'At least two Vertex calls must be made (Pass A + Pass B)');

    // Pass A prompt: structured extraction, contains the full proposal text with section labels
    assert.equal(
      passAPrompt.includes('SHARED / PUBLIC PORTION'),
      true,
      'Pass A prompt must include shared section label inside proposal_text_excerpt',
    );
    assert.equal(
      passAPrompt.includes('CONFIDENTIAL PORTION'),
      true,
      'Pass A prompt must include confidential section label inside proposal_text_excerpt',
    );
    assert.equal(
      passAPrompt.includes('source_coverage'),
      true,
      'Pass A prompt must instruct the model to populate source_coverage',
    );

    // Pass B prompt: evaluation framing — must NOT use old alignment framing
    assert.equal(
      passBPrompt.includes('contract/proposal alignment'),
      false,
      'Pass B prompt must not contain old alignment framing',
    );

    // Pass B prompt: must state mediation-first objective
    assert.equal(
      passBPrompt.includes('commercially literate mediator'),
      true,
      'Pass B prompt must state mediation-first objective',
    );

    // Pass B prompt: must block similarity-as-quality scoring
    assert.equal(
      passBPrompt.includes('NOT a quality signal'),
      true,
      'Pass B prompt must contain the anti-alignment similarity guardrail',
    );

    // Pass B prompt: must have the "high is rare" hard guardrail
    assert.equal(
      passBPrompt.includes('"high" fit_level is RARE'),
      true,
      'Pass B prompt must contain hard guardrail restricting "high" fit_level',
    );

    // Pass B prompt: payload must include evaluate_proposal_quality_not_alignment constraint
    assert.equal(
      passBPrompt.includes('evaluate_proposal_quality_not_alignment'),
      true,
      'Pass B prompt payload must include evaluate_proposal_quality_not_alignment constraint',
    );

    // Pass B prompt: must receive fact_sheet (primary input from Pass A)
    assert.equal(
      passBPrompt.includes('fact_sheet'),
      true,
      'Pass B prompt must include fact_sheet as primary input',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('sanity: identical shared+confidential triggers identical-tier warning and caps apply', async () => {
  const identicalText =
    'We will deliver a scalable platform ASAP with top dashboards and world-class support.';

  let callCount = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    if (callCount === 1) {
      // Pass A — low coverage since text is vague (all false)
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validFactSheetPayload({
            source_coverage: {
              has_scope: false,
              has_timeline: false,
              has_kpis: false,
              has_constraints: false,
              has_risks: false,
            },
            missing_info: [
              'No KPIs or success criteria defined.',
              'Timeline is vague ("ASAP") — no dates or milestones.',
              '"Scalable" is undefined.',
            ],
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Pass B — model returns low confidence for vague identical text
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(
        validPayload({
          fit_level: 'low',
          confidence_0_1: 0.45,
          why: ['Proposal mentions a platform and dashboards, but lacks specifics.'],
          missing: ['No KPIs defined.', 'Timeline is vague.'],
          redactions: [],
        }),
      ),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: identicalText,
      confidentialText: identicalText, // intentionally identical
      requestId: 'req-sanity-identical-1',
    });

    assert.equal(outcome.ok, true, 'Should parse successfully');
    if (!outcome.ok) return;

    // Identical vague texts must not produce high fit
    assert.notEqual(outcome.data.fit_level, 'high', 'Identical vague texts must not produce fit_level: high');
    // Caps must have fired (coverageCount=0 → 0.65 cap, missingCritical → 0.75 cap)
    assert.equal(outcome.data.confidence_0_1 <= 0.65, true, 'Vague identical proposal must be capped at <= 0.65');
    // Identical-tier warning must be appended by applyCoverageClamps
    const warningPresent = outcome.data.missing.some((m) =>
      m.includes('identical'),
    );
    assert.equal(warningPresent, true, 'missing[] must contain identical-tier warning');
    // _internal metadata must record the caps applied
    assert.equal(Array.isArray(outcome._internal?.caps_applied), true, '_internal.caps_applied must be an array');
    assert.equal(outcome._internal.caps_applied.includes('warn_identical_tiers'), true, 'warn_identical_tiers cap must be recorded');
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

// ─── 2-pass + coverage clamps (new tests for Prompt 2) ───────────────────────

test('2-pass: two Vertex calls are made (Pass A fact sheet + Pass B eval)', async () => {
  const calls = [];

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    calls.push(prompt);
    if (calls.length === 1) {
      // Pass A
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Pass B
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared: deliver analytics module with SLA definitions.',
      confidentialText: 'Confidential: budget is fixed, approved vendor list applies.',
      requestId: 'req-2pass-calls-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    assert.ok(calls.length >= 2, 'At least two Vertex calls must be made (Pass A + Pass B, plus optional refinement/regen)');

    // Call 1 (Pass A) must instruct fact extraction (source_coverage key present)
    assert.equal(calls[0].includes('source_coverage'), true, 'Pass A prompt must mention source_coverage');
    assert.equal(calls[0].includes('missing_info'), true, 'Pass A prompt must mention missing_info');

    // Call 2 (Pass B) must reference fact_sheet as primary input
    assert.equal(calls[1].includes('fact_sheet'), true, 'Pass B prompt must include fact_sheet');
    assert.equal(calls[1].includes('evaluate_proposal_quality_not_alignment'), true,
      'Pass B prompt must include evaluate_proposal_quality_not_alignment constraint');

    // _internal metadata must expose the fact sheet and call counts
    if (outcome.ok) {
      assert.equal(typeof outcome._internal?.fact_sheet, 'object', '_internal.fact_sheet must be an object');
      assert.equal(outcome._internal.pass_b_attempt_count, 1, '_internal.pass_b_attempt_count must be 1');
      assert.equal(outcome._internal.pass_a_parse_error, false, '_internal.pass_a_parse_error must be false');
    }
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('2-pass clamps: vague input → coverageCount < 3 plus material blockers → low confidence and low fit', async () => {
  // Pass A returns a fact sheet with only 1 out of 5 coverage fields true (scope only).
  // coverageCount = 1 < 3 → cap_0.65 + downgrade_high fires.
  const lowCoverageFactSheet = validFactSheetPayload({
    source_coverage: {
      has_scope: true,
      has_timeline: false,
      has_kpis: false,
      has_constraints: false,
      has_risks: false,
    },
    missing_info: [
      'No timeline defined.',
      'No KPIs or success criteria.',
      'No constraints stated.',
      'No risks identified.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    // Pass A — low coverage
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(lowCoverageFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass B — model ignores guardrails and tries to return high/0.95
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'high', confidence_0_1: 0.95 })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'We will build a scalable system ASAP.',
      confidentialText: 'Confidential: some internal notes.',
      requestId: 'req-clamp-low-coverage-1',
    });

    assert.equal(outcome.ok, true, 'Should still succeed (clamps, not failure)');
    if (!outcome.ok) return;

    // fit_level must be downgraded from high and land at low once the
    // contradiction pass sees multiple unresolved core blockers.
    assert.notEqual(outcome.data.fit_level, 'high', 'fit_level must not be high when coverage < 3');
    assert.equal(outcome.data.fit_level, 'low', 'fit_level must be downgraded to low for materially unbounded proposals');

    // confidence must be materially reduced, not left near the old 0.65/0.75 ceilings.
    assert.equal(outcome.data.confidence_0_1 <= 0.45, true, 'confidence_0_1 must be capped at <= 0.45');

    // _internal must record the caps applied
    assert.equal(
      outcome._internal?.caps_applied.includes('cap_0.65_low_coverage'),
      true,
      'cap_0.65_low_coverage must be recorded in caps_applied',
    );
    assert.equal(
      outcome._internal?.caps_applied.includes('downgrade_high_low_coverage'),
      true,
      'downgrade_high_low_coverage must be recorded in caps_applied',
    );
    assert.equal(
      outcome._internal?.caps_applied.includes('downgrade_medium_severe_uncertainty'),
      true,
      'downgrade_medium_severe_uncertainty must be recorded in caps_applied',
    );
    assert.equal(
      outcome._internal?.caps_applied.includes('cap_0.45_severe_uncertainty'),
      true,
      'cap_0.45_severe_uncertainty must be recorded in caps_applied',
    );
    assert.equal(outcome._internal?.coverage_count, 1, 'coverage_count must be 1');
  } finally {
    cleanup();
  }
});

test('2-pass clamps: missing KPIs/timeline/constraints/risks triggers 0.75 cap', async () => {
  // Pass A: scope + timeline present, but kpis/constraints/risks all missing.
  // coverageCount = 2 < 3 → also triggers the stricter 0.65 cap.
  // To isolate the 0.75 clamp specifically, use coverage = 3 (scope+timeline+constraints but no kpis+risks).
  // coverageCount = 3 (NOT < 3), but missingCritical = true (has_kpis=false, has_risks=false) → 0.75 cap only.
  const partialCoverageFactSheet = validFactSheetPayload({
    source_coverage: {
      has_scope: true,
      has_timeline: true,
      has_kpis: false,     // missing
      has_constraints: true,
      has_risks: false,    // missing
    },
    missing_info: ['No KPIs defined.', 'No risks identified.'],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(partialCoverageFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass B model attempts high/0.9 — must be capped
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'high', confidence_0_1: 0.9 })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Analytics dashboard with 6-month timeline and clear constraints.',
      confidentialText: 'Confidential: budget and vendor details.',
      requestId: 'req-clamp-kpi-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    // confidence must be capped at 0.75 (0.65 does NOT fire since coverageCount=3)
    assert.equal(outcome.data.confidence_0_1 <= 0.75, true, 'confidence_0_1 must be capped at <= 0.75');
    // fit_level must be downgraded from high
    assert.notEqual(outcome.data.fit_level, 'high', 'fit_level must not be high when critical fields missing');

    assert.equal(
      outcome._internal?.caps_applied.includes('cap_0.75_missing_critical'),
      true,
      'cap_0.75_missing_critical must be recorded',
    );
    assert.equal(outcome._internal?.coverage_count, 3, 'coverage_count must be 3');
  } finally {
    cleanup();
  }
});

test('2-pass clamps: full coverage + detailed proposal → high/medium preserved, confidence not clamped', async () => {
  // Pass A returns full-coverage fact sheet (all 5 true) → coverageCount = 5, no missing critical.
  // No clamps should fire. The Pass B result must come through unchanged.
  const cleanup = setVertexV2MockSequence([
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.78 })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Analytics dashboard with 6-month timeline, defined KPIs, constraints, and risk register.',
      confidentialText: 'Confidential: budget is $300k, approved vendors list provided.',
      requestId: 'req-no-clamp-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    // No clamps should have fired — values must be exactly as the model returned
    assert.equal(outcome.data.fit_level, 'medium', 'fit_level must be exactly as model returned');
    assert.equal(outcome.data.confidence_0_1, 0.78, 'confidence_0_1 must be exactly as model returned (no clamp)');

    // Structural normalization is acceptable, but readiness/confidence caps
    // must not fire when the proposal is fully covered and non-contradictory.
    const caps = outcome._internal?.caps_applied || [];
    assert.equal(caps.includes('cap_0.65_low_coverage'), false, 'low-coverage cap must not fire');
    assert.equal(caps.includes('cap_0.75_missing_critical'), false, 'missing-critical cap must not fire');
    assert.equal(caps.includes('calibrate_conditional'), false, 'conditional calibration must not fire');
    assert.equal(caps.includes('cap_0.45_severe_uncertainty'), false, 'severe-uncertainty cap must not fire');
    assert.equal(caps.includes('downgrade_high_low_coverage'), false, 'low-coverage downgrade must not fire');
    assert.equal(caps.includes('downgrade_high_missing_critical'), false, 'missing-critical downgrade must not fire');
    assert.equal(caps.includes('downgrade_high_material_uncertainty'), false, 'material-uncertainty downgrade must not fire');
    assert.equal(caps.includes('downgrade_medium_severe_uncertainty'), false, 'severe-uncertainty downgrade must not fire');
    assert.equal(outcome._internal?.coverage_count, 5, 'coverage_count must be 5 for full-coverage sheet');
  } finally {
    cleanup();
  }
});

test('consistency calibration: unresolved data cleanup, acceptance, and change-order risk force a conditional verdict', async () => {
  const riskyButStructuredFactSheet = validFactSheetPayload({
    missing_info: [
      'Source data quality and cleanup effort are not quantified.',
      'Acceptance criteria for the MVP are not defined.',
      'Change-order triggers for remediation work are undefined.',
    ],
    open_questions: [
      'Who owns legacy data remediation before migration?',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(riskyButStructuredFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'high',
          confidence_0_1: 0.95,
          why: [
            'Snapshot: The proposal looks polished and broadly workable.',
            'Key Risks: Data dependencies are mentioned but not fully resolved.',
            'Key Strengths: Scope and timeline are presented clearly.',
            'Decision Readiness: Ready to proceed, although source data quality must be defined and remediation depends on the client team.',
            'Recommendations: Proceed and tighten details during delivery.',
          ],
          missing: [
            'Source data quality is unquantified.',
          ],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal defines MVP modules, milestones, and headline success metrics.',
      confidentialText: 'Confidential notes mention legacy data cleanup and customer-side remediation ownership.',
      requestId: 'req-conditional-calibration-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.fit_level, 'medium', 'material unresolved risk should force a conditional medium verdict');
    assert.equal(outcome.data.confidence_0_1 <= 0.78, true, 'confidence must not remain near 0.95 when contradictions remain');
    assert.equal(
      outcome._internal?.caps_applied.includes('downgrade_high_material_uncertainty'),
      true,
      'material-uncertainty downgrade must be recorded',
    );
    assert.equal(
      outcome._internal?.caps_applied.includes('calibrate_conditional'),
      true,
      'conditional calibration must be recorded',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Decision status: Proceed with conditions') || entry.includes('Decision status: Explore further')),
      true,
      'Decision language must be rewritten to a conditional posture',
    );
    assert.equal(
      outcome.data.why.some((entry) => /Recommended Path:/i.test(entry)),
      true,
      'Recommended Path must be populated for conditional cases',
    );
    assert.equal(
      outcome.data.missing.some((entry) => entry.includes('data cleanup') && entry.includes('who owns it')),
      true,
      'missing[] must contain a source-grounded data-remediation question',
    );
    assert.equal(
      outcome.data.missing.some((entry) => entry.includes('acceptance criteria')),
      true,
      'missing[] must contain an acceptance-criteria question',
    );
    assert.equal(
      outcome.data.missing.some((entry) => entry.includes('change-order triggers')),
      true,
      'missing[] must contain a change-order question',
    );
  } finally {
    cleanup();
  }
});

test('conditional viable calibration: workable structure with unresolved conditions is upgraded from low to medium and de-duplicated', async () => {
  const conditionalFactSheet = validFactSheetPayload({
    project_goal: 'Launch a reporting MVP for finance and operations.',
    scope_deliverables: ['MVP dashboards', 'source-system ingestion', 'phase-two reporting extensions'],
    timeline: {
      start: '2026-Q3',
      duration: '12 weeks',
      milestones: ['Discovery', 'MVP release', 'Phase 2 review'],
    },
    constraints: ['Phased rollout required', 'Commercial approval depends on scope lock'],
    success_criteria_kpis: ['Dashboard load time under 2 seconds', 'Core user adoption above 75%'],
    missing_info: [
      'Acceptance criteria for phase 1 are not defined.',
      'Data cleanup and reconciliation effort are not quantified.',
      'Change-order triggers for remediation work are undefined.',
    ],
    open_questions: [
      'Which party owns remediation of legacy source data before the MVP release?',
    ],
  });

  const repeatedBlocker = 'Data cleanup is still unknown and prevents a clean commitment.';
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(conditionalFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'low',
          confidence_0_1: 0.64,
          why: [
            `Snapshot: ${repeatedBlocker}`,
            `Key Risks: ${repeatedBlocker}`,
            'Key Strengths: The phased structure is sensible and the commercial posture looks workable.',
            `Decision Readiness: ${repeatedBlocker}`,
            `Recommendations: ${repeatedBlocker}`,
          ],
          missing: [
            'Clarify data cleanup and acceptance.',
          ],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal defines phased delivery, named MVP modules, and measurable performance targets.',
      confidentialText: 'Confidential notes mention data remediation uncertainty and dependency assumptions.',
      requestId: 'req-conditional-viable-upgrade-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.fit_level, 'medium', 'workable but unbounded proposals should normalize to medium rather than low');
    assert.equal(
      outcome._internal?.caps_applied.includes('upgrade_low_conditional_viable'),
      true,
      'upgrade_low_conditional_viable must be recorded',
    );

    const whyText = outcome.data.why.join('\n');
    assert.equal(
      (whyText.match(/Data cleanup is still unknown and prevents a clean commitment\./g) || []).length <= 1,
      true,
      'the same blocker sentence must not be repeated across sections',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Mediation Summary:') || entry.includes('Where Agreement Exists:')),
      true,
      'Mediation Summary or Where Agreement Exists should retain bilateral alignment language',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Proposed Bridge:') || entry.includes('Option A —') || entry.includes('Recommended Path:')),
      true,
      'Proposed Bridge or Recommended Path should include bridge-to-agreement options',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('parties') || entry.includes('alignment') || entry.includes('both sides')),
      true,
      'Output should surface bilateral mediation language (parties, alignment, or both sides)',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Decision status:') || entry.includes('Decision Readiness:')),
      true,
      'Decision Readiness should contain a decision status assessment',
    );
    assert.equal(/lock define\b/i.test(whyText), false, 'Decision Readiness prose must stay grammatical');
    assert.equal(
      outcome.data.missing.length >= 4,
      true,
      'missing[] should be fuller for conditional-but-viable cases',
    );
  } finally {
    cleanup();
  }
});

test('generalization: service outsourcing proposal with workable structure but open service-level ownership lands as medium', async () => {
  const serviceFactSheet = validFactSheetPayload({
    project_goal: 'Provide facilities maintenance coverage across two operating sites.',
    scope_deliverables: ['Preventive maintenance visits', 'Emergency callout coverage', 'Monthly service reports'],
    timeline: {
      start: '2026-07-01',
      duration: '12 months',
      milestones: ['Mobilization', 'Quarterly review'],
    },
    constraints: ['Work must comply with site safety rules', 'Service windows must avoid production downtime'],
    success_criteria_kpis: ['Response time under 4 hours', 'Completion rate above 95%'],
    vendor_preferences: ['Fixed monthly service fee preferred'],
    risks: [{ risk: 'after-hours access delays', impact: 'med', likelihood: 'med' }],
    missing_info: [
      'Service acceptance thresholds for completed work orders are not defined.',
      'Out-of-scope repair approval and change-order treatment are undefined.',
      'Ownership of site access dependencies is unclear.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(serviceFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'low',
          confidence_0_1: 0.7,
          why: [
            'Snapshot: The current structure is a workable starting point once service-level ownership is clarified.',
            'Key Risks: Access dependencies and out-of-scope repairs are not fully allocated.',
            'Key Strengths: The service cadence and commercial posture are workable.',
            'Decision Readiness: Not yet bounded tightly enough for commitment.',
            'Recommendations: Resolve the operating conditions before signature.',
          ],
          missing: ['Clarify service-level ownership.'],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covers preventive maintenance visits, emergency callout coverage, and monthly reporting for two sites.',
      confidentialText: 'Confidential notes mention access approvals and change-order assumptions.',
      requestId: 'req-generalization-service-medium-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.fit_level, 'medium', 'a workable non-software proposal should normalize to medium when the issue is boundedness, not viability');
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Decision status: Proceed with conditions') || entry.includes('Decision status: Explore further') || entry.includes('workable')),
      true,
      'the body should reflect a viable-but-conditional interpretation',
    );
  } finally {
    cleanup();
  }
});

test('generalization: genuinely weak non-software proposal remains low', async () => {
  const weakPartnershipFactSheet = validFactSheetPayload({
    project_goal: 'Explore an exclusive distribution partnership.',
    scope_deliverables: [],
    timeline: { start: null, duration: null, milestones: [] },
    constraints: ['Immediate exclusivity requested with no committed volume or territory definition'],
    success_criteria_kpis: [],
    risks: [],
    open_questions: [
      'Which territories are exclusive?',
      'How will revenue be shared?',
    ],
    missing_info: [
      'No defined obligations for either party.',
      'No revenue-sharing or pricing structure is stated.',
      'No timeline, term, or exit conditions are defined.',
    ],
    source_coverage: {
      has_scope: false,
      has_timeline: false,
      has_kpis: false,
      has_constraints: true,
      has_risks: false,
    },
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(weakPartnershipFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.72,
          why: [
            'Snapshot: The proposal is exploratory but broad.',
            'Key Risks: Scope, commercial structure, and timing are unresolved.',
            'Key Strengths: The parties have at least identified an interest in partnering.',
            'Decision Readiness: The current materials are not bounded enough to support commitment.',
            'Recommendations: Clarify the partnership mechanics.',
          ],
          missing: ['Clarify the commercial structure.'],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal requests immediate exclusivity under a future commercial partnership.',
      confidentialText: 'Confidential notes show no defined volume, territory, or revenue model.',
      requestId: 'req-generalization-weak-low-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.fit_level, 'low', 'genuinely weak non-software proposals should remain low');
  } finally {
    cleanup();
  }
});

test('visibility-aware normalization removes already visible categories from missing and redactions', async () => {
  const facilitiesFactSheet = validFactSheetPayload({
    project_goal: 'Provide routine facilities inspections across named sites.',
    scope_deliverables: ['North Plant inspections', 'South Depot inspections', 'Weekly inspection reports'],
    timeline: {
      start: '2026-08-01',
      duration: '12 months',
      milestones: ['Mobilization', 'First monthly review'],
    },
    constraints: ['Service windows must avoid production downtime'],
    success_criteria_kpis: ['Response time under 4 hours'],
    missing_info: [
      'Service-level acceptance thresholds are not defined.',
      'Rework approval rules are undefined.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(facilitiesFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.66,
          why: [
            'Snapshot: North Plant and South Depot are both named in the current service scope.',
            'Key Risks: Weekly inspection reports are listed, but sign-off thresholds remain open.',
            'Key Strengths: The proposal names the covered sites and reporting cadence.',
            'Decision Readiness: The remaining issue is bounded service-level sign-off, not identification of the sites or reports.',
            'Recommendations: Resolve the acceptance thresholds and rework rules.',
          ],
          missing: [
            'What sites are in scope? — determines service coverage.',
            'What reporting deliverables are in scope? — determines operational coverage.',
            'What service-level acceptance thresholds define satisfactory completion? — determines sign-off and dispute exposure.',
          ],
          redactions: [
            'site names',
            'weekly inspection reports',
            'internal margin assumptions',
          ],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal names North Plant and South Depot and includes weekly inspection reports.',
      confidentialText: 'Confidential notes include internal margin assumptions.',
      requestId: 'req-visibility-normalization-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(
      outcome.data.missing.some((entry) => /\bsites\b/i.test(entry) || /\breporting deliverables\b/i.test(entry)),
      false,
      'missing[] must not claim already visible sites or deliverables are missing',
    );
    assert.equal(
      outcome.data.missing.some((entry) => /acceptance thresholds/i.test(entry)),
      true,
      'missing[] should retain genuinely unresolved detail inside a visible category',
    );
    assert.equal(
      outcome.data.redactions.includes('site names') || outcome.data.redactions.includes('weekly inspection reports'),
      false,
      'redactions[] must not repeat already visible categories',
    );
    assert.equal(
      outcome.data.redactions.includes('internal margin assumptions'),
      true,
      'redactions[] may keep genuinely non-visible protected detail',
    );
  } finally {
    cleanup();
  }
});

test('presentation hygiene: visible fragment artifacts are removed from why, missing, and redactions', async () => {
  const factSheet = validFactSheetPayload({
    project_goal: 'Coordinate a site-services mobilization across three facilities.',
    scope_deliverables: ['Mobilization plan', 'Service schedule', 'Site reporting pack'],
    constraints: ['Mobilization must avoid operational downtime'],
    missing_info: [
      'Acceptance criteria are not defined.',
      'Dependency ownership is unclear.',
    ],
    open_questions: [
      'Who owns site-access approvals before mobilization?',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(factSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.68,
          why: [
            'Snapshot: The structure is workable. condi...',
            'Key Risks: Conditions to proc...',
            'Key Strengths: The phased structure is workable.',
            'Decision Readiness: The parties still need to define the initial scope. Next negotiation agenda: define sign-off condi...',
            'Recommendations: Paths to agreement: use a discovery-first phase. Conditions to proceed: define scope and acceptance...',
          ],
          missing: [
            'What acceptance criteria define sign-off? — determines payment and completion condi...',
            'What party owns site-access dependencies? — determines timeline risk.',
          ],
          redactions: [
            'internal pricing floor...',
          ],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covers site mobilization, service scheduling, and reporting across three facilities.',
      confidentialText: 'Confidential notes mention pricing floor and approval dependencies.',
      requestId: 'req-presentation-fragments-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    const missingText = outcome.data.missing.join('\n');
    const redactionsText = outcome.data.redactions.join('\n');

    assert.equal(/(?:\.\.\.|…)/.test(whyText), false, 'why[] must not expose visible ellipsis fragments');
    assert.equal(/(?:\.\.\.|…)/.test(missingText), false, 'missing[] must not expose visible ellipsis fragments');
    assert.equal(/(?:\.\.\.|…)/.test(redactionsText), false, 'redactions[] must not expose visible ellipsis fragments');
    assert.equal(/Conditions to proc(?!eed)/i.test(whyText), false, 'partial locked prefixes must not survive in why[]');
  } finally {
    cleanup();
  }
});

test('presentation hygiene: awkward stock blocker wording is rewritten into natural phrasing', async () => {
  const factSheet = validFactSheetPayload({
    missing_info: [
      'Scope is broad and out-of-scope items are not defined.',
      'Acceptance criteria are not defined.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(factSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.71,
          why: [
            'Snapshot: core scope is not bounded tightly enough.',
            'Key Risks: core scope is not bounded tightly enough.',
            'Key Strengths: There is a phased structure.',
            'Decision Readiness: core scope is not bounded tightly enough.',
            'Recommendations: core scope is not bounded tightly enough.',
          ],
          missing: ['Clarify scope boundary.'],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal defines phases, milestones, and a headline delivery target.',
      confidentialText: 'Confidential notes mention unresolved scope and sign-off assumptions.',
      requestId: 'req-presentation-phrase-cleanup-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n').toLowerCase();
    assert.equal(
      whyText.includes('core scope is not bounded tightly enough'),
      false,
      'raw stock blocker phrasing must be rewritten into natural sentence forms',
    );
    assert.equal(
      whyText.includes('tighter definition') || whyText.includes('scope and commitment') || whyText.includes('not yet bounded tightly enough'),
      true,
      'cleaned prose should still express the same blocker in a natural way',
    );
  } finally {
    cleanup();
  }
});

test('presentation hygiene: key strengths becomes more substantive when multiple concrete positives exist', async () => {
  const facilitiesFactSheet = validFactSheetPayload({
    project_goal: 'Provide planned maintenance coverage across two manufacturing sites.',
    scope_deliverables: ['Preventive maintenance plan', 'Emergency callout coverage', 'Monthly operations reporting'],
    timeline: {
      start: '2026-09-01',
      duration: '12 months',
      milestones: ['Mobilization', 'Quarterly review'],
    },
    constraints: ['Site work must avoid production downtime'],
    success_criteria_kpis: ['Response time under 4 hours', 'Completion rate above 95%'],
    risks: [{ risk: 'after-hours access approvals', impact: 'med', likelihood: 'med' }],
    missing_info: [
      'Rework approval rules are undefined.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(facilitiesFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.7,
          why: [
            'Snapshot: The structure is workable but still conditional.',
            'Key Risks: Rework approval remains open.',
            'Key Strengths: The proposal is clear.',
            'Decision Readiness: The parties still need to define rework handling.',
            'Recommendations: Resolve the remaining approval condition.',
          ],
          missing: ['Clarify rework approval rules.'],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covers preventive maintenance, emergency callouts, monthly reporting, milestones, and response targets.',
      confidentialText: 'Confidential notes mention access approvals and rework caveats.',
      requestId: 'req-presentation-strengths-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    const mediationEntry = outcome.data.why.find((entry) => entry.startsWith('Mediation Summary:')) || '';
    assert.equal(mediationEntry.length > 0, true, 'Mediation Summary entry should exist');
    assert.equal(
      mediationEntry.includes('alignment') || mediationEntry.includes('workable') || mediationEntry.includes('structure'),
      true,
      'Mediation Summary should include concrete alignment or structural language',
    );
    assert.equal(
      /clear and specific|well thought out|clear\./i.test(mediationEntry),
      false,
      'Mediation Summary should not collapse into generic praise',
    );
  } finally {
    cleanup();
  }
});

test('presentation hygiene: empty redactions collapse to an empty array so no visible redactions section is emitted downstream', async () => {
  const factSheet = validFactSheetPayload({
    missing_info: ['Acceptance criteria are not defined.'],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(factSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.69,
          why: [
            'Snapshot: The proposal is workable but conditional.',
            'Key Risks: Acceptance remains open.',
            'Key Strengths: There is a phased rollout.',
            'Decision Readiness: The parties still need to define sign-off.',
            'Recommendations: Resolve the acceptance condition.',
          ],
          missing: ['Clarify acceptance criteria.'],
          redactions: ['   ', '...', '—'],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal includes phases, milestones, and sign-off references.',
      confidentialText: 'Confidential notes contain no extra protected topics.',
      requestId: 'req-presentation-empty-redactions-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.redactions.length, 0, 'redactions[] should collapse to empty when only blank or fragment entries remain');
    assert.equal(
      outcome.data.why.some((entry) => /^Redactions:/i.test(entry)),
      false,
      'customer-facing why[] must not emit an empty redactions heading',
    );
  } finally {
    cleanup();
  }
});

test('presentation hygiene: open questions are deduped when two items resolve the same acceptance uncertainty', async () => {
  const serviceFactSheet = validFactSheetPayload({
    project_goal: 'Provide warehousing and dispatch coverage for a regional distribution program.',
    scope_deliverables: ['Inbound receiving', 'Dispatch handling', 'Monthly service reporting'],
    timeline: {
      start: '2026-10-01',
      duration: '9 months',
      milestones: ['Mobilization', 'Quarterly review'],
    },
    constraints: ['Operations must remain live during transition'],
    success_criteria_kpis: ['Dispatch accuracy above 98%'],
    missing_info: [
      'Acceptance criteria for completed service volumes are not defined.',
      'Definition of done for the initial service phase is unclear.',
      'Change-order triggers for out-of-scope handling are undefined.',
    ],
    open_questions: [
      'Who signs off on completed service volumes each month?',
      'What measurable acceptance criteria determine whether the initial phase is complete?',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(serviceFactSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.68,
          why: [
            'Snapshot: The service structure is workable once sign-off and variation handling are bounded.',
            'Key Risks: Acceptance and change-order treatment remain open.',
            'Key Strengths: The core service cadence is defined.',
            'Decision Readiness: The parties still need to define sign-off and change handling.',
            'Recommendations: Resolve the acceptance and change-order mechanics.',
          ],
          missing: [
            'What measurable acceptance criteria define completion for the initial service phase? — determines sign-off and payment exposure.',
            'Who signs off on completed service volumes each month? — determines sign-off and payment exposure.',
            'What change-order triggers apply to out-of-scope handling? — determines commercial protection and dispute exposure.',
          ],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covers inbound receiving, dispatch handling, service reporting, and a mobilization timeline.',
      confidentialText: 'Confidential notes mention sign-off and variation assumptions.',
      requestId: 'req-presentation-open-question-dedupe-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    const acceptanceQuestionCount = outcome.data.missing.filter((entry) =>
      /(acceptance criteria|definition of done|signs off|sign-off)/i.test(entry),
    ).length;
    assert.equal(
      acceptanceQuestionCount <= 1,
      true,
      'missing[] should keep a single highest-value acceptance/sign-off question when multiple prompts resolve the same uncertainty',
    );
    assert.equal(
      outcome.data.missing.some((entry) => /change-order triggers/i.test(entry)),
      true,
      'distinct commercial protection questions must remain after dedupe',
    );
  } finally {
    cleanup();
  }
});

// ─── Report style: determinism + conditional modules (Prompt 3) ───────────────

test('style: computeReportStyleSeed + selectReportStyle are deterministic', () => {
  // Same input → same seed and same style every time.
  const text = 'We will deliver an analytics dashboard with defined KPIs and a 6-month timeline.';
  const seed1 = computeReportStyleSeed({ proposalTextExcerpt: text });
  const seed2 = computeReportStyleSeed({ proposalTextExcerpt: text });
  assert.equal(seed1, seed2, 'Same text must produce the same seed');
  assert.equal(seed1 >= 0 && seed1 < 10000, true, 'Seed must be in 0-9999 range');

  const style1 = selectReportStyle(seed1);
  const style2 = selectReportStyle(seed1);
  assert.equal(style1.style_id, style2.style_id, 'Same seed must produce same style_id');
  assert.equal(style1.ordering, style2.ordering, 'Same seed must produce same ordering');
  assert.equal(style1.verbosity, style2.verbosity, 'Same seed must produce same verbosity');
  assert.equal(style1.seed, seed1, 'style.seed must equal the input seed');

  // Valid enum values.
  assert.equal(
    ['analytical', 'direct', 'collaborative'].includes(style1.style_id),
    true,
    'style_id must be a valid enum value',
  );
  assert.equal(
    ['risks_first', 'strengths_first', 'balanced'].includes(style1.ordering),
    true,
    'ordering must be a valid enum value',
  );
  assert.equal(
    ['tight', 'standard', 'deep'].includes(style1.verbosity),
    true,
    'verbosity must be a valid enum value',
  );

  // proposalId takes precedence over text — seeding by ID must be stable.
  const seedById1 = computeReportStyleSeed({ proposalTextExcerpt: text, proposalId: 'prop-abc-123' });
  const seedById2 = computeReportStyleSeed({ proposalTextExcerpt: 'DIFFERENT TEXT', proposalId: 'prop-abc-123' });
  assert.equal(seedById1, seedById2, 'proposalId must take precedence over text for seeding');
});

test('style: report_style appears in Pass B prompt payload and _internal', async () => {
  let passBPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Capture the Pass B prompt (call #2); refinement/regen calls are #3+
    if (callCount === 2) passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Deliver analytics module with 6-month timeline, KPIs, risks, and constraints documented.',
      confidentialText: 'Confidential: budget is fixed at approved level, vendor review has occurred.',
      requestId: 'req-style-prompt-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    assert.ok(callCount >= 2, 'At least two Vertex calls must be made (Pass A + Pass B)');

    // Pass B prompt must contain report_style in the INPUT JSON payload.
    assert.equal(
      passBPrompt.includes('report_style'),
      true,
      'Pass B prompt must include report_style in constraints payload',
    );
    assert.equal(
      passBPrompt.includes('style_id'),
      true,
      'Pass B prompt must include style_id',
    );
    assert.equal(
      passBPrompt.includes('ordering'),
      true,
      'Pass B prompt must include ordering in payload',
    );
    assert.equal(
      passBPrompt.includes('verbosity'),
      true,
      'Pass B prompt must include verbosity in payload',
    );

    // _internal must expose report_style.
    if (outcome.ok) {
      const rs = outcome._internal?.report_style;
      assert.equal(typeof rs, 'object', '_internal.report_style must be an object');
      assert.equal(
        ['analytical', 'direct', 'collaborative'].includes(rs?.style_id),
        true,
        '_internal.report_style.style_id must be a valid enum value',
      );
      assert.equal(
        ['risks_first', 'strengths_first', 'balanced'].includes(rs?.ordering),
        true,
        '_internal.report_style.ordering must be a valid enum value',
      );
      assert.equal(typeof rs?.seed, 'number', '_internal.report_style.seed must be a number');
    }
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('style: legacy optional headings are not instructed even when timeline data exists', async () => {
  async function capturePassBPrompt(factSheetOverrides) {
    let passBPrompt = '';
    let callCount = 0;
    globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          model: 'gemini-2.0-flash-001',
          text: JSON.stringify(validFactSheetPayload(factSheetOverrides)),
          finishReason: 'STOP',
          httpStatus: 200,
        };
      }
      if (callCount === 2) passBPrompt = prompt;
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    };
    await evaluateMediationWithVertexV2({
      sharedText: 'Deliver analytics module with specified KPIs, risks, and constraints.',
      confidentialText: 'Confidential: budget and governance details provided.',
      requestId: 'req-style-modules-1',
    });
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    return passBPrompt;
  }

  const promptWithTimeline = await capturePassBPrompt({
    source_coverage: { has_scope: true, has_timeline: true, has_kpis: true, has_constraints: true, has_risks: true },
    vendor_preferences: [],
  });
  assert.equal(
    promptWithTimeline.includes('Implementation Notes'),
    false,
    'Implementation Notes must not appear in the revised mediation prompt',
  );
  assert.equal(
    promptWithTimeline.includes('OUTPUT SHAPE'),
    true,
    'OUTPUT SHAPE must appear in the revised mediation prompt',
  );
});

test('style: legacy vendor-fit heading is absent while leverage headings remain', async () => {
  async function capturePassBPrompt(factSheetOverrides) {
    let passBPrompt = '';
    let callCount = 0;
    globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          model: 'gemini-2.0-flash-001',
          text: JSON.stringify(validFactSheetPayload(factSheetOverrides)),
          finishReason: 'STOP',
          httpStatus: 200,
        };
      }
      if (callCount === 2) passBPrompt = prompt;
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    };
    await evaluateMediationWithVertexV2({
      sharedText: 'Deliver analytics module with KPIs, timeline, risks, and constraints defined.',
      confidentialText: 'Confidential: budget and governance details provided.',
      requestId: 'req-style-vendor-1',
    });
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    return passBPrompt;
  }

  const promptWithVendor = await capturePassBPrompt({
    vendor_preferences: ['Preferred: AWS', 'Excluded: on-premise only vendors'],
  });
  assert.equal(
    promptWithVendor.includes('Vendor Fit Notes'),
    false,
    'Vendor Fit Notes must not appear in the revised mediation prompt',
  );
  assert.equal(
    promptWithVendor.includes('Where the Parties Align') || promptWithVendor.includes('Possible Bridges') || promptWithVendor.includes('What Is Blocking Agreement'),
    true,
    'Adaptive section headings must remain available in the prompt',
  );
});

// ─── Golden property tests (regression fixtures) ──────────────────────────────
// Each fixture specifies fact-sheet + model output + expected properties.
// Tests assert: clamp behavior, heading instructions, telemetry safety, style determinism.

for (const fixture of goldenFixtures.cases) {
  test(`golden: ${fixture.name}`, async () => {
    let passBPrompt = '';
    let callCount = 0;

    globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
      callCount += 1;
      if (callCount === 1) {
        // Pass A — return the fixture's fact sheet
        return {
          model: 'gemini-2.0-flash-001',
          text: JSON.stringify(fixture.factSheet),
          finishReason: 'STOP',
          httpStatus: 200,
        };
      }
      // Pass B — capture full prompt, return fixture model output
      passBPrompt = prompt;
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(fixture.passBModelOutput),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    };

    try {
      const outcome = await evaluateMediationWithVertexV2({
        sharedText: fixture.sharedText,
        confidentialText: fixture.confidentialText,
        requestId: fixture.proposalId ?? undefined,
      });

      assert.equal(outcome.ok, true, `[${fixture.name}] evaluateWithVertexV2 should succeed`);
      if (!outcome.ok) return;

      const exp = fixture.expected;

      // ── Confidence cap ──────────────────────────────────────────────────
      if (typeof exp.maxConfidence === 'number') {
        assert.equal(
          outcome.data.confidence_0_1 <= exp.maxConfidence,
          true,
          `[${fixture.name}] confidence_0_1 (${outcome.data.confidence_0_1}) must be <= ${exp.maxConfidence}`,
        );
      }

      // ── fit_level ───────────────────────────────────────────────────────
      if (exp.fitNotHigh) {
        assert.notEqual(outcome.data.fit_level, 'high', `[${fixture.name}] fit_level must not be 'high'`);
      }
      if (exp.expectedFit) {
        assert.equal(outcome.data.fit_level, exp.expectedFit, `[${fixture.name}] fit_level must be '${exp.expectedFit}'`);
      }

      // ── missing count ───────────────────────────────────────────────────
      if (typeof exp.minMissingCount === 'number') {
        assert.equal(
          outcome.data.missing.length >= exp.minMissingCount,
          true,
          `[${fixture.name}] missing.length (${outcome.data.missing.length}) must be >= ${exp.minMissingCount}`,
        );
      }

      // ── clamps applied ──────────────────────────────────────────────────
      if (Array.isArray(exp.expectedClampsApplied)) {
        for (const clamp of exp.expectedClampsApplied) {
          assert.equal(
            outcome._internal?.caps_applied.includes(clamp),
            true,
            `[${fixture.name}] caps_applied must include '${clamp}'`,
          );
        }
      }
      if (Array.isArray(exp.shouldExcludeClamps)) {
        for (const clamp of exp.shouldExcludeClamps) {
          assert.equal(
            outcome._internal?.caps_applied.includes(clamp),
            false,
            `[${fixture.name}] caps_applied must NOT include '${clamp}'`,
          );
        }
      }

      // ── required headings in why[] ──────────────────────────────────────
      if (Array.isArray(exp.mustContainHeadings)) {
        const headingAliases = {
          'Mediation Summary': ['Mediation Summary', 'Executive Summary', 'Snapshot', 'Decision Assessment', 'Risk Summary', 'Key Risks'],
          'Decision Readiness': ['Decision Readiness'],
          'Recommended Path': ['Recommended Path', 'Recommendations', 'Suggested Next Step'],
          'Where Agreement Exists': ['Where Agreement Exists', 'Negotiation Insights'],
          'The Real Hesitation': ['The Real Hesitation', 'Leverage Signals'],
          'Proposed Bridge': ['Proposed Bridge', 'Potential Deal Structures'],
        };
        for (const heading of exp.mustContainHeadings) {
          const acceptable = headingAliases[heading] || [heading];
          const found = acceptable.some((candidate) =>
            outcome.data.why.some((s) => s.toLowerCase().includes(candidate.toLowerCase())),
          );
          assert.equal(found, true, `[${fixture.name}] why[] must contain heading '${heading}'`);
        }
      }

      if (Array.isArray(exp.shouldExcludeOptionalHeadings)) {
        for (const heading of exp.shouldExcludeOptionalHeadings) {
          assert.equal(
            passBPrompt.includes(heading),
            false,
            `[${fixture.name}] Pass B prompt must NOT instruct optional heading '${heading}'`,
          );
        }
      }

      // ── telemetry structure & safety ────────────────────────────────────
      const t = outcome._internal?.telemetry;
      assert.equal(typeof t, 'object', `[${fixture.name}] _internal.telemetry must be an object`);
      assert.equal(t?.version, 'eval_v2', `[${fixture.name}] telemetry.version must be 'eval_v2'`);
      assert.equal(typeof t?.coverageCount, 'number', `[${fixture.name}] telemetry.coverageCount must be a number`);
      assert.equal(typeof t?.fit_level, 'string', `[${fixture.name}] telemetry.fit_level must be a string`);
      assert.equal(typeof t?.confidence_0_1, 'number', `[${fixture.name}] telemetry.confidence_0_1 must be a number`);
      assert.equal(typeof t?.missingCount, 'number', `[${fixture.name}] telemetry.missingCount must be a number`);
      assert.equal(typeof t?.sharedChars, 'number', `[${fixture.name}] telemetry.sharedChars must be a number`);
      assert.equal(
        t?.sharedChars,
        fixture.sharedText.length,
        `[${fixture.name}] telemetry.sharedChars must equal sharedText.length`,
      );
      assert.equal(
        t?.confidentialChars,
        fixture.confidentialText.length,
        `[${fixture.name}] telemetry.confidentialChars must equal confidentialText.length`,
      );
      // Telemetry JSON must NOT contain raw proposal text
      const tJson = JSON.stringify(t);
      assert.equal(
        tJson.includes(fixture.sharedText),
        false,
        `[${fixture.name}] telemetry JSON must not contain raw sharedText`,
      );
      // Only assert confidentialText safety if the texts differ (identical-tier cases share content)
      if (fixture.sharedText !== fixture.confidentialText) {
        assert.equal(
          tJson.includes(fixture.confidentialText),
          false,
          `[${fixture.name}] telemetry JSON must not contain raw confidentialText`,
        );
      }

      // ── deterministic style for proposalId cases ────────────────────────
      if (fixture.proposalId) {
        // proposalId is used as the stable seed input (passed as requestId)
        const expectedSeed = computeReportStyleSeed({
          proposalTextExcerpt: 'irrelevant-text-because-proposalId-takes-precedence',
          proposalId: fixture.proposalId,
        });
        const expectedStyle = selectReportStyle(expectedSeed);
        assert.equal(
          outcome._internal?.report_style.style_id,
          expectedStyle.style_id,
          `[${fixture.name}] report_style.style_id must be deterministic for proposalId`,
        );
        assert.equal(
          outcome._internal?.report_style.ordering,
          expectedStyle.ordering,
          `[${fixture.name}] report_style.ordering must be deterministic for proposalId`,
        );
        assert.equal(
          outcome._internal?.report_style.verbosity,
          expectedStyle.verbosity,
          `[${fixture.name}] report_style.verbosity must be deterministic for proposalId`,
        );
        // Telemetry must echo same style
        assert.equal(
          t?.reportStyle.style_id,
          expectedStyle.style_id,
          `[${fixture.name}] telemetry.reportStyle.style_id must match deterministic selection`,
        );
      }
    } finally {
      delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    }
  });
}

// ─── Anti-leak regression: telemetry + outputs must never expose confidential canary ─────

test('anti-leak: telemetry and outputs do not contain raw confidential canary string', async () => {
  const canary = 'CONFIDENTIAL_CANARY_9f3a2';
  const sharedText = 'We will deliver an analytics dashboard with defined KPIs and a 6-month timeline.';
  const confidentialText = `Internal governance note: the canary token is ${canary}. Budget allocation confirmed.`;

  let callCount = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    if (callCount === 1) {
      // Pass A — full-coverage fact sheet (no confidential strings in it)
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Pass B — safe output (no leak)
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.72 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText,
      confidentialText,
      requestId: 'req-antileak-canary-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    // Client-facing output must not contain the canary
    const whyJoined = outcome.data.why.join(' ');
    const missingJoined = outcome.data.missing.join(' ');
    const redactionsJoined = outcome.data.redactions.join(' ');
    assert.equal(whyJoined.includes(canary), false, 'output.why must not contain confidential canary');
    assert.equal(missingJoined.includes(canary), false, 'output.missing must not contain confidential canary');
    assert.equal(redactionsJoined.includes(canary), false, 'output.redactions must not contain confidential canary');

    // Telemetry JSON must not contain the canary
    const telemetryJson = JSON.stringify(outcome._internal?.telemetry ?? {});
    assert.equal(telemetryJson.includes(canary), false, 'telemetry JSON must not contain confidential canary');

    // Telemetry must have character counts (not the text itself)
    assert.equal(
      outcome._internal?.telemetry?.confidentialChars,
      confidentialText.length,
      'telemetry must record confidentialChars length',
    );
    assert.equal(
      outcome._internal?.telemetry?.confidentialChunkCount > 0,
      true,
      'telemetry must record confidentialChunkCount > 0',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

// ─── New tests: Prompt safety + tight retry ────────────────────────────────

test('Pass B prompt does not include shared_chunks or confidential_chunks arrays', async () => {
  let passAPrompt = null;
  let passBPrompt = null;
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async (params) => {
    callCount += 1;
    if (callCount === 1) {
      passAPrompt = params.prompt;
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Capture the Pass B prompt (call #2); refinement/regen calls are #3+
    if (callCount === 2) passBPrompt = params.prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared text describing deliverables, timeline, and KPIs for the project.',
      confidentialText: 'Confidential: internal budget is 500k; team of 3 engineers.',
      requestId: 'req-prompt-no-chunks-1',
    });
    assert.equal(outcome.ok, true, 'evaluation must succeed');

    // Pass B prompt must not embed chunk arrays.
    assert.ok(passBPrompt, 'Pass B prompt must have been captured');
    assert.equal(
      passBPrompt.includes('"shared_chunks"'),
      false,
      'Pass B prompt must NOT contain "shared_chunks" key',
    );
    assert.equal(
      passBPrompt.includes('"confidential_chunks"'),
      false,
      'Pass B prompt must NOT contain "confidential_chunks" key',
    );
    // It must include the count fields instead.
    assert.equal(
      passBPrompt.includes('"shared_chunk_count"'),
      true,
      'Pass B prompt must include "shared_chunk_count"',
    );
    assert.equal(
      passBPrompt.includes('"confidential_chunk_count"'),
      true,
      'Pass B prompt must include "confidential_chunk_count"',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('Tight retry fires on truncation and succeeds on second attempt', async () => {
  let passBCallCount = 0;
  let tightModeDetected = false;

  const cleanup = setVertexV2MockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1 — truncated → triggers tight retry
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: '{"fit_level":"high","confidence_0_1":0.9,"why":["partial cut]',
        finishReason: 'MAX_TOKENS',
        httpStatus: 200,
      },
    },
    // Pass B attempt 2 (tight mode) — succeeds with valid response
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.68 })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  // Wrap the mock to detect tight mode on second Pass B call.
  const originalMock = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async (params) => {
    const result = await originalMock(params);
    // Detect if tight mode prompt was used (has 'STRICT COMPACT MODE').
    if (params.prompt && params.prompt.includes('STRICT COMPACT MODE')) {
      tightModeDetected = true;
    }
    return result;
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared text for tight retry scenario with enough meaningful content.',
      confidentialText: 'Confidential text for tight retry scenario with enough meaningful content.',
      requestId: 'req-tight-retry-1',
    });
    assert.equal(outcome.ok, true, 'outcome must be ok:true after tight retry success');
    if (!outcome.ok) return;
    assert.equal(outcome.attempt_count, 2, 'must have used 2 Pass B attempts');
    assert.equal(tightModeDetected, true, 'tight mode must have been used on the retry');
    assert.equal(outcome.data.fit_level, 'medium', 'fit_level from second attempt must be returned');
    // No fallback warning because second attempt succeeded.
    assert.ok(
      !outcome._internal.warnings || outcome._internal.warnings.length === 0,
      '_internal.warnings must be empty when tight retry succeeds',
    );
  } finally {
    cleanup();
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('anti-leak: fallback path output does not contain confidential canary', async () => {
  const canary = 'FALLBACK_CANARY_7b91e';
  const badJsonResponse = {
    model: 'gemini-2.0-flash-001',
    text: 'not valid json',
    finishReason: 'STOP',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    // Pass A — fact sheet does NOT embed canary
    { response: factSheetResponse() },
    // Pass B attempt 1 — invalid JSON
    { response: badJsonResponse },
    // Pass B attempt 2 (tight retry) — still invalid JSON → fallback used
    { response: badJsonResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal text for anti-leak fallback check.',
      confidentialText: `Confidential details contain the canary ${canary} and budget info.`,
      requestId: 'req-fallback-antileak-1',
    });
    assert.equal(outcome.ok, true, 'fallback must return ok:true');
    if (!outcome.ok) return;

    // Fallback output must not contain the canary at any level.
    const outputJson = JSON.stringify(outcome.data);
    assert.equal(outputJson.includes(canary), false, 'fallback output JSON must not contain canary');

    const internalJson = JSON.stringify(outcome._internal);
    assert.equal(internalJson.includes(canary), false, '_internal JSON must not contain canary');

    // Confirm it's actually the fallback path.
    assert.ok(
      Array.isArray(outcome._internal.warnings) && outcome._internal.warnings.length > 0,
      '_internal.warnings must be non-empty on fallback path',
    );
    assert.equal(outcome._internal.fallback_mode, 'salvaged_memo', 'full fact-sheet fallback should be classified as salvageable');
    assert.notEqual(outcome.data.fit_level, 'unknown', 'salvaged fallback must not surface as unknown');
  } finally {
    cleanup();
  }
});

test('section-safe truncation drops lower-priority content without cutting locked prefixes', async () => {
  const longSentence = 'This paragraph adds grounded detail about the remaining scope, data, acceptance, and commercial posture without resolving the blocker. ';
  const oversized = longSentence.repeat(60).trim();
  const factSheet = validFactSheetPayload({
    missing_info: [
      'Acceptance criteria are not defined.',
      'Data cleanup is unquantified.',
      'Change-order triggers are undefined.',
    ],
    open_questions: [
      'Who owns data remediation before delivery?',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(factSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'high',
          confidence_0_1: 0.94,
          why: [
            `Snapshot: ${oversized}`,
            `Key Risks: ${oversized}`,
            `Key Strengths: ${oversized}`,
            `Decision Readiness: ${oversized}`,
            `Recommendations: ${oversized}`,
          ],
          missing: ['Acceptance criteria are undefined.'],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal with phased deliverables, timeline, and KPI references.',
      confidentialText: 'Confidential notes mention data remediation and commercial caveats.',
      requestId: 'req-truncation-guard-1',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    const totalChars = outcome.data.why.reduce((sum, entry) => sum + entry.length + 1, 0);
    assert.equal(totalChars <= 5800, true, 'why[] must still respect the max character budget');
    assert.equal(whyText.includes('…'), false, 'truncation must drop content instead of blind character slicing');
    assert.equal(/Decision stat(?!us)/i.test(whyText), false, 'Decision status prefix must not be cut mid-label');
    assert.equal(/Recommended pat(?!h)/i.test(whyText), false, 'Recommended path prefix must not be cut mid-label');
    assert.equal(/Option [A-C]\s*[—-](?!\s)/i.test(whyText), false, 'Option labels must not be cut mid-label');
    assertCleanRenderedEndings(outcome.data.why, 'tight-budget why[]');
    assertCleanRenderedEndings(outcome.data.missing, 'tight-budget missing[]');
  } finally {
    cleanup();
  }
});

test('fallback memo stays domain-aware for software deals and keeps deal structures concrete', async () => {
  const truncatedResponse = {
    model: 'gemini-2.0-flash-001',
    text: '{"fit_level":"medium","confidence_0_1":0.7,"why":["partial"]',
    finishReason: 'MAX_TOKENS',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    {
      response: factSheetResponse(validFactSheetPayload({
        project_goal: 'Implement a customer analytics platform with API integrations and staged rollout.',
        scope_deliverables: ['API integration layer', 'Customer data migration', 'Analytics dashboard', 'Support playbook'],
        timeline: { start: '2026-Q3', duration: '7 months', milestones: ['Integration sandbox', 'Pilot rollout', 'Production go-live'] },
        constraints: ['Must work with the existing CRM', 'Weekend deployment windows only', 'Enterprise SLA required'],
        success_criteria_kpis: ['Dashboard adoption above 75%', 'P1 response under 30 minutes'],
        assumptions: ['Customer data quality is still being assessed'],
        open_questions: ['Who owns migration remediation before go-live?'],
        missing_info: ['Migration remediation is not scoped.', 'Support SLA and post-launch coverage remain open.'],
      })),
    },
    { response: truncatedResponse },
    { response: truncatedResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared software proposal covers integrations, migration, support, and staged rollout.',
      confidentialText: 'Internal notes mention pricing flexibility and implementation staffing constraints.',
      requestId: 'req-domain-software-fallback-1',
    });

    assert.equal(outcome.ok, true, 'software fallback evaluation must succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    assert.match(whyText, /\bintegration|migration|SLA|rollout|remediation/i);
    assert.match(whyText, /discovery|resolve|reconvene|finalise/i);
    assertCleanRenderedEndings(outcome.data.why, 'software why[]');
  } finally {
    cleanup();
  }
});

test('fallback memo stays domain-aware for investment deals without reverting to software jargon', async () => {
  const truncatedResponse = {
    model: 'gemini-2.0-flash-001',
    text: '{"fit_level":"medium","confidence_0_1":0.7,"why":["partial"]',
    finishReason: 'MAX_TOKENS',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    {
      response: factSheetResponse(validFactSheetPayload({
        project_goal: 'Raise a Series A round to extend runway and fund commercial expansion.',
        scope_deliverables: ['Series A financing package', 'Board governance framework', 'Milestone plan'],
        timeline: { start: '2026-Q2', duration: '10 weeks', milestones: ['Lead investor diligence', 'Term sheet negotiation', 'Close'] },
        constraints: ['Target runway extension of 18 months', 'Board observer request under discussion'],
        success_criteria_kpis: ['Close the round within the quarter', 'Maintain operating runway through close'],
        assumptions: ['Lead investor is still evaluating governance protections'],
        risks: [{ risk: 'Diligence delays', impact: 'high', likelihood: 'med' }],
        open_questions: ['Would capital be released in one close or through milestone tranches?'],
        missing_info: ['Valuation and governance terms are still open.', 'Investor protection package is not final.'],
      })),
    },
    { response: truncatedResponse },
    { response: truncatedResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared fundraising materials reference valuation, board rights, diligence, and milestone financing.',
      confidentialText: 'Internal notes mention runway sensitivity and governance priorities.',
      requestId: 'req-domain-investment-fallback-1',
    });

    assert.equal(outcome.ok, true, 'investment fallback evaluation must succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    assert.match(whyText, /\bvaluation|dilution|governance|board|tranche|diligence|runway\b/i);
    assert.equal(/\bdiscovery phase\b/i.test(whyText), false, 'investment memo must not fall back to software discovery phrasing');
    assert.match(whyText, /valuation|governance|investor|control/i);
    assertCleanRenderedEndings(outcome.data.why, 'investment why[]');
  } finally {
    cleanup();
  }
});

test('fallback memo stays domain-aware for supply deals and surfaces MOQ or exclusivity tradeoffs', async () => {
  const truncatedResponse = {
    model: 'gemini-2.0-flash-001',
    text: '{"fit_level":"medium","confidence_0_1":0.7,"why":["partial"]',
    finishReason: 'MAX_TOKENS',
    httpStatus: 200,
  };

  const cleanup = setVertexV2MockSequence([
    {
      response: factSheetResponse(validFactSheetPayload({
        project_goal: 'Secure a manufacturing and distribution agreement for the next regional product launch.',
        scope_deliverables: ['Production lots', 'Regional distribution support', 'Quality assurance reporting'],
        timeline: { start: '2026-Q3', duration: '5 months', milestones: ['Pilot batch', 'Regional launch', 'Quarterly supply review'] },
        constraints: ['MOQ under discussion', 'Lead time target of 8 weeks', 'Warranty claims process not final', 'Regional exclusivity requested'],
        success_criteria_kpis: ['On-time fill rate above 98%', 'Defect rate below 0.5%'],
        assumptions: ['Forecast accuracy still depends on the launch plan'],
        risks: [{ risk: 'Lead-time slippage', impact: 'high', likelihood: 'med' }],
        open_questions: ['What volume commitment is required to support the pricing tiers?'],
        missing_info: ['Defect definitions remain open.', 'Exclusivity thresholds are not final.'],
      })),
    },
    { response: truncatedResponse },
    { response: truncatedResponse },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared supply proposal references lead times, MOQ discussion, warranty treatment, and regional rollout.',
      confidentialText: 'Internal notes mention capacity utilization and forecast sensitivity.',
      requestId: 'req-domain-supply-fallback-1',
    });

    assert.equal(outcome.ok, true, 'supply fallback evaluation must succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    assert.match(whyText, /\bMOQ|minimum orders|lead times|warranty|defect|exclusivity\b/i);
    assert.match(whyText, /volume|pricing|exclusivity|capacity|specification/i);
    assertCleanRenderedEndings(outcome.data.why, 'supply why[]');
  } finally {
    cleanup();
  }
});

// ─── Memo-prose prompt constraints ────────────────────────────────────────────

test('memo-prose: Pass B prompt contains bilateral negotiator guardrails instead of coaching artifacts', async () => {
  let passBPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) {
      // Pass A — full coverage so tight mode doesn't activate
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validFactSheetPayload()),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Capture the Pass B prompt (call #2); refinement/regen calls are #3+
    if (callCount === 2) passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.72 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared: deliver analytics module with SLA definitions and monthly milestones.',
      confidentialText: 'Confidential: budget fixed, governance approval secured.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    assert.ok(passBPrompt.length > 0, 'Pass B prompt must have been captured');

    // Fixed 2–3 paragraph writing requirement
    assert.ok(
      passBPrompt.includes('2\u20133 short paragraphs'),
      'Pass B prompt must specify the 2\u20133 short paragraphs per required heading writing requirement',
    );

    // Prose-first / sparingly rule (replacing hard "Max 1 bullet list")
    assert.ok(
      passBPrompt.includes('Prose-first'),
      'Pass B prompt must include a Prose-first writing instruction',
    );
    assert.ok(
      passBPrompt.includes('sparingly'),
      'Pass B prompt must instruct that bullets are used sparingly, not by default',
    );

    // if/then tradeoff requirement
    assert.ok(
      passBPrompt.includes('if/then'),
      'Pass B prompt must require explicit if/then tradeoff statements',
    );

    // Bilateral shareability guardrail
    assert.ok(
      passBPrompt.includes('both parties will read the report') || passBPrompt.includes('shared neutral artifact'),
      'Pass B prompt must explicitly frame Step 3 as a bilateral shareable artifact',
    );

    assert.ok(
      passBPrompt.includes('OUTPUT SHAPE'),
      'Pass B prompt must define output shape to reduce repetition',
    );
    assert.ok(
      passBPrompt.includes('DOMAIN-SENSITIVE LENS'),
      'Pass B prompt must include an explicit domain-sensitive writing block',
    );
    assert.ok(
      passBPrompt.includes('Domain lens: software / data-platform context'),
      'Software-oriented fact sheets must receive software-specific prompt guidance',
    );

    assert.ok(
      passBPrompt.includes('Avoid exaggerated language') || passBPrompt.includes('Do not overstate') || passBPrompt.includes('Ban empty filler'),
      'Pass B prompt must explicitly ban overstated severity language or empty filler',
    );

    assert.ok(
      passBPrompt.includes('Where the Parties Align') || passBPrompt.includes('Negotiation Insights') || passBPrompt.includes('where the parties already align'),
      'Pass B prompt must address where agreement or alignment exists',
    );
    assert.ok(
      passBPrompt.includes('The Real Hesitation') || passBPrompt.includes('Leverage Signals') || passBPrompt.includes('real hesitation'),
      'Pass B prompt must address real hesitation or leverage dynamics',
    );
    assert.ok(
      passBPrompt.includes('Suggested Bridge') || passBPrompt.includes('Potential Deal Structures') || passBPrompt.includes('bridge or sequencing') || passBPrompt.includes('What bridge would help'),
      'Pass B prompt must address proposed bridge or deal structures',
    );
    assert.ok(
      passBPrompt.includes('Decision status'),
      'Pass B prompt must require an explicit Decision status paragraph',
    );
    assert.ok(
      passBPrompt.includes('demands') || passBPrompt.includes('priorities'),
      'Pass B prompt must address demands or priorities',
    );
    assert.ok(
      passBPrompt.includes('flexibility') || passBPrompt.includes('concessions'),
      'Pass B prompt must address flexibility or possible concessions',
    );
    assert.ok(
      passBPrompt.includes('possible dealbreakers') || passBPrompt.includes('likely non-negotiables'),
      'Pass B prompt must explicitly address dealbreakers / non-negotiables',
    );
    assert.ok(
      passBPrompt.includes('"stated", "strongly implied", or "not clearly established"'),
      'Pass B prompt must require explicit dealbreaker support labels',
    );
    assert.ok(
      passBPrompt.includes('compatible with adjustments') && passBPrompt.includes('fundamentally incompatible'),
      'Pass B prompt must define the compatibility assessment states',
    );
    assert.ok(
      passBPrompt.includes('bridgeability'),
      'Pass B prompt must explicitly require bridgeability analysis',
    );
    assert.ok(
      passBPrompt.includes('negotiation_analysis'),
      'Pass B prompt must expose the optional structured negotiation_analysis schema',
    );

    // Explicit anti-coaching language
    assert.ok(
      passBPrompt.includes('DO NOT coach one side'),
      'Pass B prompt must explicitly ban one-sided coaching',
    );

    assert.ok(
      passBPrompt.includes('medium = viable but conditional / pause pending clarification'),
      'Pass B prompt must define medium as the home for conditional-but-viable cases',
    );

    // Old unilateral Step 3 artifacts must be gone
    assert.equal(
      passBPrompt.includes('First 2 weeks plan'),
      false,
      'Pass B prompt must not require the old First 2 weeks plan advisory block',
    );
    assert.equal(
      passBPrompt.includes("Next call: what I'd ask for"),
      false,
      "Pass B prompt must not require the old 'Next call: what I'd ask for' advisory block",
    );
    assert.equal(
      passBPrompt.includes('Likely pushback & response'),
      false,
      "Pass B prompt must not require the old 'Likely pushback & response' wording",
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('memo-prose: missing strictness — thin coverage produces missing[] >= 6 items with em-dash why clauses', async () => {
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    if (callCount === 1) {
      // Pass A — low coverage (1/5): only has_scope = true
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validFactSheetPayload({
            source_coverage: {
              has_scope: true,
              has_timeline: false,
              has_kpis: false,
              has_constraints: false,
              has_risks: false,
            },
            missing_info: [
              'No timeline defined.',
              'No KPIs.',
              'No constraints.',
              'No risks.',
              'No acceptance criteria.',
              'No data schema.',
            ],
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    // Pass B — mock returns 6 items each with em-dash why clause as instructed
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(
        validPayload({
          fit_level: 'low',
          confidence_0_1: 0.38,
          missing: [
            'What is the confirmed go-live date and key milestone schedule? — determines resource planning and exposes schedule risk.',
            'What are the measurable success criteria and KPIs for this project? — required to define "done" and enforce scope boundaries.',
            'What budget constraints and approval thresholds apply? — impacts vendor selection and delivery model choices.',
            'What risks have been identified and what are the proposed mitigations? — needed to build a viable risk register.',
            'What is the data schema and access method for source systems? — determines ingestion architecture and governance approach.',
            'What acceptance criteria define successful delivery for each phase? — required for contractual sign-off and phase exit gates.',
          ],
        }),
      ),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Deliver a scalable analytics platform for internal teams.',
      confidentialText: 'Internal: timeline and budget are TBD pending board approval.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    if (!outcome.ok) return;

    assert.ok(
      outcome.data.missing.length >= 4,
      `missing[] must have >= 4 items when source_coverage is thin; got ${outcome.data.missing.length}`,
    );

    // Each item must contain an em-dash why clause (skip auto-injected identical-tier warning if present)
    const itemsToCheck = outcome.data.missing.filter(
      (m) => !m.toLowerCase().includes('identical') && !m.toLowerCase().includes('overlapping'),
    );
    for (const item of itemsToCheck) {
      assert.ok(
        item.includes('\u2014'),
        `missing item must include an em-dash (—) why-it-matters clause; got: "${item}"`,
      );
    }
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('memo-prose: commercial posture included in Pass B prompt when vendor_preferences include fixed price', async () => {
  let passBPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) {
      // Pass A — fact sheet with fixed-price vendor preference
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validFactSheetPayload({
            vendor_preferences: ['fixed price engagement preferred'],
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    if (callCount === 2) passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.68 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Deliver analytics platform under a fixed-price engagement model.',
      confidentialText: 'Internal: fixed-price structure preferred; budget ceiling applies.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    assert.ok(passBPrompt.length > 0, 'Pass B prompt must have been captured');

    assert.ok(
      passBPrompt.includes('fixed-price signals detected'),
      'Pass B prompt must add fixed-price-specific guidance when the fact sheet implies fixed-price posture',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('memo-prose: investment fact sheets receive fundraising-specific prompt guidance', async () => {
  let passBPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(
          validFactSheetPayload({
            project_goal: 'Raise a Series A round to fund runway and hiring.',
            scope_deliverables: ['Series A financing package', 'Board governance framework'],
            constraints: ['Board rights under discussion', 'Runway extension required'],
            assumptions: ['Lead investor diligence is still open'],
            open_questions: ['How would valuation and governance trade off if diligence takes longer?'],
            missing_info: ['Tranche structure remains open.'],
          }),
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    if (callCount === 2) passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.66 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared investment materials reference valuation, governance, runway, and milestones.',
      confidentialText: 'Internal notes mention board control and diligence sensitivities.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    assert.ok(passBPrompt.length > 0, 'Pass B prompt must have been captured');
    assert.ok(
      passBPrompt.includes('Domain lens: investment / fundraising negotiation'),
      'Investment fact sheets must receive fundraising-specific prompt guidance',
    );
    assert.equal(
      passBPrompt.includes('Do not use software-delivery language such as discovery phase'),
      true,
      'Investment prompt guidance must explicitly suppress software-delivery phrasing',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('neutralizer: one-sided coaching language is rewritten into bilateral negotiator language', async () => {
  const factSheet = validFactSheetPayload({
    missing_info: [
      'Acceptance criteria are not defined.',
      'Pricing assumptions remain open.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(factSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({
          fit_level: 'medium',
          confidence_0_1: 0.74,
          why: [
            'Snapshot: Your proposal would be better if you narrowed the commercial scope.',
            'Key Risks: Before sending, add stronger wording around pricing and acceptance.',
            'Key Strengths: The timeline is clear.',
            'Decision Readiness: You should define acceptance criteria more clearly before sending.',
            'Recommendations: You should rewrite the pricing section and strengthen the remediation language.',
          ],
          missing: [
            'Before sending, add acceptance criteria.',
          ],
          redactions: [],
        })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal defines timeline, pricing structure, and deliverables.',
      confidentialText: 'Confidential notes mention remediation assumptions and commercial caveats.',
      requestId: 'req-neutralizer-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    const whyTextLower = whyText.toLowerCase();
    assert.equal(/\byou should\b/i.test(whyText), false, 'customer-facing why[] must not contain "you should"');
    assert.equal(/\byour proposal\b/i.test(whyText), false, 'customer-facing why[] must not contain "your proposal"');
    assert.equal(/\bbefore sending\b/i.test(whyText), false, 'customer-facing why[] must not contain "before sending"');
    assert.equal(
      whyTextLower.includes('the parties') || whyTextLower.includes('the current proposal') || whyTextLower.includes('the proposing side'),
      true,
      'customer-facing why[] must be rewritten into bilateral neutral phrasing',
    );

    const missingText = outcome.data.missing.join('\n');
    assert.equal(/\bbefore sending\b/i.test(missingText), false, 'missing[] must not contain private editing instructions');
    assert.equal(
      outcome.data.missing.some((entry) => entry.includes('acceptance criteria')),
      true,
      'missing[] must be rewritten as negotiation-relevant questions',
    );
  } finally {
    cleanup();
  }
});

// ─── Quality upgrade: larger context & output ─────────────────────────────────

test('quality upgrade: MAX_SHARED_CHARS and MAX_CONFIDENTIAL_CHARS are 16000', async () => {
  // The V2 engine now supports moderately larger context (16K per tier).
  // Verify the engine does not reject inputs up to the new limit.
  const factSheet = validFactSheetPayload();
  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(validPayload()), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'A'.repeat(15000),
      confidentialText: 'B'.repeat(15000),
      requestId: 'req-larger-context-1',
    });
    assert.equal(outcome.ok, true, 'Should succeed with large inputs within the new 16K limit');
  } finally {
    cleanup();
  }
});

// ─── Quality upgrade: assessReportQuality ─────────────────────────────────────

test('quality gate: assessReportQuality returns score 1.0 for well-formed report', () => {
  const wellFormed = {
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: [
      'Recommendation: Proceed with conditions because the parties have a credible phased engagement with named dashboard work, integration responsibilities, milestone timing, and adoption measures. The commercial direction is workable, but final commitment should wait until approval authority and dependency handling are explicit.',
      'Where the Parties Align: Both sides appear to support the dashboard module, API integration, staged milestones, and an adoption target that can be observed during the six-month term. That alignment provides a practical basis for moving forward without treating later expansion as already agreed.',
      'Where the Deal Is Stuck: Final approval ownership, third-party dependency treatment, and the relationship between acceptance and payment remain open. Those gaps matter because the same milestone could otherwise be treated as complete by one side and incomplete by the other, creating avoidable timing and payment exposure.',
      'Suggested Bridge: Name one approval owner for each milestone, record the evidence required for acceptance, and use an escalation path for delayed client inputs or integration dependencies. Keep the first phase bounded and require a documented review before optional expansion work is authorized.',
      'Next Step: Hold a short closing session to assign approval authority, define milestone evidence, confirm dependency escalation, and record the change process before either side treats the engagement as final.',
    ],
    missing: [
      'What acceptance criteria define completion? — determines payment triggers and dispute risk.',
      'Who owns third-party dependencies? — controls timeline and cost overrun exposure.',
      'What change-request process applies post-signature? — determines scope flexibility versus cost certainty.',
      'What governance structure will handle disputes? — determines escalation speed and cost.',
    ],
    redactions: ['Internal budget authority'],
    internal_analysis: validInternalAnalysis({
      confidence: 0.65,
      decision_status: 'proceed_with_conditions',
    }),
    narrative: validNaturalNarrative(),
  };
  const quality = assessReportQuality(wellFormed);
  assert.equal(quality.score, 1.0, 'Well-formed report should score 1.0');
  assert.equal(quality.triggers.length, 0, 'No quality triggers for a well-formed report');
  assert.equal(quality.weakSections.length, 0, 'No weak sections for a well-formed report');
});

test('quality gate expands a compressed mediation sidecar when substantive evidence is available', async () => {
  const factSheet = validFactSheetPayload({
    project_goal: 'Test a SaaS referral and implementation partnership.',
    scope_deliverables: [
      'Non-exclusive six-month pilot',
      'Registered referrals',
      'Implementation support',
      'Training responsibilities',
    ],
    open_questions: [
      'When is commission earned?',
      'How long does client protection last?',
    ],
    missing_info: [
      'Commission trigger remains unresolved.',
      'Client-protection period remains unresolved.',
    ],
  });
  const why = [
    'Recommendation: Proceed with conditions because both sides support a bounded six-month referral pilot, implementation support, and a path to revisit economics after measurable performance. Final commitment should wait until referral attribution, client protection, and payment triggers are documented.',
    'Where the Parties Align: Both parties support a non-exclusive pilot, referral commission, separately paid implementation work, training, and potential expansion if the channel produces qualified customers. That common ground is enough to test the relationship without granting permanent rights at the outset.',
    'Where the Deal Is Stuck: The materials do not yet establish when a referral becomes attributable, how long client protection lasts, what counts as bypassing the partner, or when ongoing support earns recurring revenue share. Those gaps affect the value and control each side receives.',
    'Suggested Bridge: Use registered referrals, a defined client-protection window, clear direct-sell exceptions, commission triggered by an agreed customer event, recurring revenue share only while documented support continues, and semi-exclusivity only after a measurable performance threshold.',
    'Next Step: Draft a one-page pilot rules document covering referral registration, client protection, commission and revenue-share triggers, implementation fee ownership, support responsibilities, and the post-pilot review before final commitment.',
  ];
  const passB = validPayload({
    fit_level: 'medium',
    confidence_0_1: 0.67,
    why,
    missing: [
      'What counts as a successful referral? — determines attribution and commission eligibility.',
      'When is commission earned and paid? — determines the commercial trigger.',
      'How long does client protection last? — determines whether introductions remain protected.',
      'When does recurring revenue share apply? — ties continuing economics to active support.',
    ],
    redactions: [],
    internal_analysis: validInternalAnalysis({
      confidence: 0.67,
      core_thesis: 'The pilot is workable once attribution, protection, and payment triggers are explicit.',
      evidence_used: [
        '[shared:pilot] The current shared proposal supports a six-month referral pilot, registered attribution, client protection, and implementation support.',
      ],
      evidence_gaps: ['Commission timing and the exact client-protection window remain unresolved.'],
      unsupported_claims: [],
      grounding_summary:
        'The current shared pilot terms support a conditional path, while payment and protection mechanics remain open.',
      retrieval_warnings: [],
    }),
    narrative: validNaturalNarrative({
      title: 'A workable referral pilot, once ownership rules are explicit',
      sections: [
        {
          heading: 'Why the pilot is commercially plausible',
          paragraphs: [
            'Both sides support a six-month referral relationship and an implementation role, which creates enough common ground to test customer demand before either side grants broader channel rights. The bounded term limits the initial commitment while preserving a path to expand if the evidence is positive.',
            'The software company gains qualified introductions and implementation capacity, while the consulting partner can earn referral commission and separately priced implementation work. That division is coherent if customer attribution is documented rather than left to memory.',
          ],
        },
        {
          heading: 'The mechanics that still matter',
          paragraphs: [
            'Commission timing and the client-protection window remain unresolved. If those terms stay open, each side can reasonably believe it owns the same account or is entitled to a different payment event.',
            'A registered-referral process, a defined protection period, separate implementation fees, and recurring revenue share tied to documented support would create a practical conditional path without granting exclusivity upfront.',
          ],
        },
      ],
      closing:
        'Draft the referral-registration, client-protection, commission, implementation-fee, and support rules before final commitment.',
    }),
  });
  const narrativeTopics = [
    ['Why the pilot is worth pursuing', 'commercial intent and the bounded six-month term'],
    ['Why the pilot is worth pursuing', 'the exchange of referral access for implementation capacity'],
    ['What each side needs protected', 'the partner’s introduced accounts and the SaaS company’s direct-sales freedom'],
    ['What each side needs protected', 'commission entitlement and customer ownership'],
    ['The mechanics that decide value', 'registered attribution, payment timing, and client protection'],
    ['The mechanics that decide value', 'implementation fees, training, support, and customer handoff'],
    ['A balanced landing zone', 'a non-exclusive pilot with performance-based post-pilot rights'],
    ['A balanced landing zone', 'measurable referrals, active support, and documented renegotiation criteria'],
  ];
  const refinedNarrativeSections = [];
  narrativeTopics.forEach(([heading, topic], index) => {
    let section = refinedNarrativeSections.find((entry) => entry.heading === heading);
    if (!section) {
      section = { heading, paragraphs: [] };
      refinedNarrativeSections.push(section);
    }
    section.paragraphs.push(
      `The current proposal provides specific evidence about ${topic}. The shared materials support a six-month non-exclusive referral pilot with registered introductions, commission, implementation support, training, and a post-pilot review, which gives the parties a real commercial structure to assess rather than a generic intention to collaborate. This point matters because the recommendation depends on whether each promised benefit is connected to an observable event and a named responsibility. If the parties document that mechanic before launch, the pilot can test value without granting permanent rights; if they leave it implicit, the same customer or payment event can create competing expectations. Analysis point ${index + 1} therefore supports a conditional path while keeping long-term economics subject to measured performance.`,
    );
  });
  const refinedPassB = {
    ...passB,
    narrative: {
      title: 'A workable referral pilot, once customer and economic rules are explicit',
      sections: refinedNarrativeSections,
      closing:
        'Draft and agree a one-page Pilot Rules of Engagement covering referral registration, client protection, commission and revenue-share triggers, implementation fee ownership, support responsibilities, and post-pilot performance criteria before launch.',
    },
  };
  const quality = assessReportQuality(passB, factSheet);
  assert.equal(quality.score < 1, true);
  assert.equal(
    quality.triggers.some((entry) => entry.startsWith('narrative_too_short_for_available_evidence')),
    true,
  );

  let callCount = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        model: 'gemini-2.5-flash-lite',
        text: JSON.stringify(factSheet),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    if (callCount === 2) {
      return {
        model: 'gemini-2.5-pro',
        text: JSON.stringify(passB),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    if (callCount === 3) {
      return {
        model: 'gemini-2.5-pro',
        text: JSON.stringify(refinedPassB),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }
    throw new Error(`Unexpected quality-repair call ${callCount}`);
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Both parties support a non-exclusive six-month SaaS referral pilot with implementation support.',
      confidentialText: 'Private commercial limits exist and must remain confidential.',
      requestId: 'req-current-sidecar-no-refinement',
      maxQualityRepairCalls: 1,
      evidenceCandidates: [
        {
          id: 'shared:pilot',
          source_type: 'shared_contribution',
          source_label: 'Shared pilot proposal',
          source_role: 'proposer',
          visibility: 'shared',
          text:
            'Both parties support a non-exclusive six-month SaaS referral pilot with registered referrals, client protection, commission, implementation support, training, and a post-pilot review.',
          round_number: 1,
        },
      ],
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(callCount, 3);
    assert.equal(outcome._internal.refinement?.attempted, true);
    assert.equal(outcome._internal.refinement?.applied, true);
    assert.equal(outcome._internal.runtime?.quality_repair_call_count, 1);
    assert.equal(outcome._internal.regeneration?.triggered, false);
    assert.equal(outcome._internal.narrative_validation?.renderer_path, 'narrative');
    const narrativeWords = JSON.stringify(outcome.data.narrative || '')
      .split(/\s+/)
      .filter(Boolean).length;
    assert.equal(narrativeWords >= 900, true);
    assert.equal(outcome._internal.retrieval?.retrieval_strategy, 'heuristic_commercial_terms_v1');
    assert.equal(outcome._internal.retrieval?.evidence_count, 1);
    assert.equal('retrieved_evidence_packet' in outcome._internal, false);
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('quality gate flags a strong retrieved evidence packet that internal analysis ignores', () => {
  const report = validPayload({
    why: [
      'Recommendation: Proceed with conditions because the current pilot structure is commercially plausible, but the remaining economic mechanics need agreement before commitment.',
      'Where the Parties Align: Both sides support a bounded pilot and a referral relationship that can be tested before broader commitments are made.',
      'Where the Deal Is Stuck: Referral attribution and client protection are not yet defined, leaving account ownership and commission eligibility unresolved.',
      'Suggested Bridge: Use registered referrals, a defined protection window, and a commission trigger tied to an agreed customer event.',
      'Next Step: Record the attribution, protection, and commission rules in a one-page pilot document before launch.',
    ],
    missing: [
      'What event earns commission? — determines the payment trigger.',
      'How long does client protection last? — determines whether the referral remains attributed.',
    ],
    internal_analysis: validInternalAnalysis({
      evidence_used: ['The materials generally support a pilot.'],
    }),
    narrative: validNaturalNarrative({
      sections: [
        {
          heading: 'A plausible pilot',
          paragraphs: [
            'The parties have a commercially plausible basis for a bounded pilot, but the current terms do not yet allocate the customer relationship clearly. That uncertainty affects whether either side can rely on the proposed economics.',
            'The main unresolved mechanics are referral attribution and client protection. If those rules remain undefined, the same customer can create competing expectations about ownership and commission.',
          ],
        },
        {
          heading: 'A practical path',
          paragraphs: [
            'A registered-referral process and defined protection period would connect the commercial benefit to an observable event. The pilot can then test the relationship without granting broader rights before performance is known.',
          ],
        },
      ],
    }),
  });
  const packet = {
    retrieval_strategy: 'heuristic_commercial_terms_v1',
    evidence_count: 1,
    omitted_evidence_count: 0,
    token_budget_used: 30,
    character_budget_used: 120,
    retrieval_warnings: [],
    generated_at: '2026-06-13T00:00:00.000Z',
    items: [
      {
        id: 'recipient:attribution',
        source_type: 'shared_contribution',
        source_label: 'Shared by Recipient',
        source_role: 'recipient',
        visibility: 'shared',
        relevance_score: 90,
        title_or_summary: 'Attribution concern',
        excerpt: 'Registered referral attribution and a client-protection window remain unresolved.',
        extracted_terms: ['customer_attribution'],
        confidence: 0.9,
        include_reason: 'contains deal-specific attribution evidence',
        limitations: [],
      },
    ],
  };

  const quality = assessReportQuality(report, undefined, packet);
  assert.equal(
    quality.triggers.includes('retrieved_evidence_not_used_in_internal_analysis'),
    true,
  );
});

test('quality gate evaluates narrative substance and decision consistency', () => {
  const quality = assessReportQuality({
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: 'medium',
    confidence_0_1: 0.58,
    why: [
      'Executive Summary: The proposal has a plausible commercial basis but still leaves several material mechanics unresolved across the intended relationship.',
      'Decision Assessment: The open terms affect value, responsibility, and the conditions required before either side can make a reliable commitment.',
    ],
    missing: [
      'When is commission earned? — determines payment timing.',
      'How long does client protection last? — determines attribution certainty.',
    ],
    redactions: [],
    narrative: {
      title: 'Ready now',
      sections: [
        {
          heading: 'Recommendation',
          paragraphs: ['Approve this agreement immediately.'],
        },
      ],
      closing: 'Sign now.',
    },
  });

  assert.equal(quality.score < 0.5, true);
  assert.equal(
    quality.triggers.includes('narrative_section_count_invalid'),
    true,
  );
  assert.equal(
    quality.triggers.includes('narrative_conflicts_with_conditional_or_negative_decision'),
    true,
  );
  assert.equal(quality.weakSections.includes('narrative'), true);
});

test('quality gate: assessReportQuality penalizes short why[] content', () => {
  const thinReport = {
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: ['Executive Summary: Short.', 'Decision Assessment: Brief.'],
    missing: [
      'Question one? — reason.',
      'Question two? — reason.',
      'Question three? — reason.',
      'Question four? — reason.',
    ],
    redactions: [],
  };
  const quality = assessReportQuality(thinReport);
  assert.ok(quality.score < 1.0, 'Thin report should score below 1.0');
  assert.ok(quality.triggers.some((t) => t.startsWith('why_too_short')), 'Should flag why_too_short');
});

test('quality gate: assessReportQuality penalizes missing required sections', () => {
  const incompleteReport = {
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: [
      'Implementation Notes: The deal covers scope and timeline.',
    ],
    missing: [
      'Q1? — reason.',
      'Q2? — reason.',
      'Q3? — reason.',
      'Q4? — reason.',
    ],
    redactions: [],
  };
  const quality = assessReportQuality(incompleteReport);
  assert.ok(quality.score < 0.5, 'Report missing required sections should score below 0.5');
  assert.ok(quality.weakSections.length > 0, 'Should identify weak sections');
  assert.ok(quality.triggers.some((t) => t.startsWith('missing_section')), 'Should trigger missing_section');
});

test('quality gate: assessReportQuality penalizes excessive generic filler', () => {
  const fillerReport = {
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: [
      'Executive Summary: The proposal shows clarity and specificity. It is a well-structured proposal with a mature approach. The deal looks broadly workable and the documents are presented clearly.',
      'Decision Assessment: The decision-ready qualities show good coverage overall.',
      'Negotiation Insights: Insight text for negotiation topics.',
      'Leverage Signals: Leverage considerations for the parties.',
      'Potential Deal Structures: Deal structure options.',
      'Decision Readiness: Decision status: Proceed with conditions.',
      'Recommended Path: Recommended next step for the parties.',
    ],
    missing: [
      'Q1? — reason.', 'Q2? — reason.', 'Q3? — reason.', 'Q4? — reason.',
    ],
    redactions: [],
  };
  const quality = assessReportQuality(fillerReport);
  assert.ok(quality.score < 1.0, 'Filler-heavy report should score below 1.0');
  assert.ok(quality.triggers.some((t) => t.startsWith('excessive_filler')), 'Should flag excessive filler');
});

test('quality gate: assessReportQuality penalizes too few missing items', () => {
  const quality = assessReportQuality({
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: [
      'Executive Summary: Substantive summary that is long enough to pass minimum length checks across all seven required why sections with adequate detail.',
      'Decision Assessment: Assessment details.',
      'Negotiation Insights: Insight details.',
      'Leverage Signals: Leverage details.',
      'Potential Deal Structures: Structure details.',
      'Decision Readiness: Decision status: Proceed with conditions.',
      'Recommended Path: Path recommendation details.',
    ],
    missing: ['One question? — reason.'],
    redactions: [],
  });
  assert.ok(quality.triggers.some((t) => t.startsWith('too_few_missing')), 'Should flag too_few_missing');
});

// ─── Quality upgrade: multi-pass refinement ───────────────────────────────────

test('quality upgrade: refinement metadata is present in _internal when quality < 1.0', async () => {
  // A mediocre Pass B output triggers quality assessment. Since the mock
  // sequence has no 3rd entry, refinement will fail gracefully.
  const factSheet = validFactSheetPayload();
  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(validPayload({
      why: ['Executive Summary: Short.'],
      missing: ['One question.'],
    })), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covering project scope and delivery milestones.',
      confidentialText: 'Internal budget constraints and approval timeline.',
      requestId: 'req-refinement-meta-1',
    });
    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;
    assert.ok(outcome._internal.refinement, 'Should have refinement metadata');
    assert.equal(outcome._internal.refinement.attempted, true, 'Should have attempted refinement');
    assert.equal(outcome._internal.refinement.applied, false, 'Refinement should fail (mock exhausted)');
    assert.ok(outcome._internal.refinement.skip_reason, 'Should record skip reason');
  } finally {
    cleanup();
  }
});

test('quality upgrade: refinement applies when 3rd mock returns valid improved data', async () => {
  const factSheet = validFactSheetPayload();
  const initialPassB = validPayload({
    why: ['Executive Summary: Short initial text.'],
    missing: ['Q1.'],
  });
  const refinedPassB = validPayload({
    fit_level: initialPassB.fit_level,
    confidence_0_1: initialPassB.confidence_0_1,
    why: [
      'Executive Summary: The deal covers scope, timeline, and delivery mechanics with named deliverables and milestones. However, acceptance criteria and sign-off governance remain undefined, creating payment and completion risk.',
      'Decision Assessment: Risk areas include scope creep potential and undefined acceptance criteria. Strengths include named milestones and structured delivery phases.',
      'Negotiation Insights: The proposing side may prioritize billing predictability; the counterparty may want scope flexibility and clear dependency ownership.',
      'Leverage Signals: Timeline pressure may favor the side with mobilization readiness. Switching costs are moderate due to domain knowledge.',
      'Potential Deal Structures: Option A — fixed-scope with milestone billing. Option B — phased discovery, then binding SOW.',
      'Decision Readiness: Decision status: Proceed with conditions. Acceptance criteria and dependency owners must be named.',
      'Recommended Path: Define commitment boundary and acceptance criteria before the current draft becomes binding.',
    ],
    missing: [
      'What acceptance criteria define completion? — determines payment triggers.',
      'Who owns third-party dependencies? — controls timeline exposure.',
      'What change-request process applies? — determines scope flexibility.',
      'What governance handles disputes? — determines escalation speed.',
    ],
  });

  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(initialPassB), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(refinedPassB), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covering project scope, deliverables, and phased milestones.',
      confidentialText: 'Internal budget cap of $500K and leadership approval required by Q2.',
      requestId: 'req-refinement-applied-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.ok(outcome._internal.refinement, 'Should have refinement metadata');
    assert.equal(outcome._internal.refinement.attempted, true);
    assert.equal(outcome._internal.refinement.applied, true, 'Refinement should be applied (improved quality)');
  } finally {
    cleanup();
  }
});

test('quality upgrade: refinement preserves fit_level — rejects changed fit', async () => {
  const factSheet = validFactSheetPayload();
  const initialPassB = validPayload({
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: ['Executive Summary: Short.'],
    missing: ['Q1.'],
  });
  // Refined output tries to change fit_level → should be rejected
  const badRefined = validPayload({
    fit_level: 'high',
    confidence_0_1: 0.65,
    why: [
      'Executive Summary: Substantial detailed summary meeting all quality criteria with enough text to pass length checks.',
      'Decision Assessment: Detailed assessment.',
      'Negotiation Insights: Detailed insights.',
      'Leverage Signals: Detailed signals.',
      'Potential Deal Structures: Detailed structures.',
      'Decision Readiness: Decision status: Ready to finalize.',
      'Recommended Path: Detailed recommendation.',
    ],
    missing: ['Q1? — reason.', 'Q2? — reason.', 'Q3? — reason.', 'Q4? — reason.'],
  });
  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(initialPassB), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(badRefined), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Proposal text for the engagement.',
      confidentialText: 'Internal budget constraints.',
      requestId: 'req-refinement-fit-guard-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome._internal.refinement.attempted, true);
    assert.equal(outcome._internal.refinement.applied, false, 'Refinement must not apply if fit_level changed');
    assert.equal(outcome._internal.refinement.skip_reason, 'refinement_changed_fit_level');
  } finally {
    cleanup();
  }
});

// ─── Quality upgrade: regeneration ────────────────────────────────────────────

test('quality upgrade: regeneration metadata is present and structured', async () => {
  // Post-processing rescues weak output via role defaults, so regen typically
  // does NOT trigger. This test verifies the metadata structure exists.
  const factSheet = validFactSheetPayload();
  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(validPayload()), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal text.',
      confidentialText: 'Confidential notes.',
      requestId: 'req-regen-metadata-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.ok(outcome._internal.regeneration, 'Should have regeneration metadata');
    assert.equal(typeof outcome._internal.regeneration.triggered, 'boolean');
    assert.ok(Array.isArray(outcome._internal.regeneration.reasons));
    assert.equal(typeof outcome._internal.regeneration.applied, 'boolean');
    // If not triggered, applied must be false and reasons empty
    if (!outcome._internal.regeneration.triggered) {
      assert.equal(outcome._internal.regeneration.applied, false);
      assert.equal(outcome._internal.regeneration.reasons.length, 0);
    }
  } finally {
    cleanup();
  }
});

test('quality upgrade: quality is assessed on raw output, not post-processed', async () => {
  // Quality assessment runs BEFORE post-processing so that refinement/regen
  // can detect genuine weaknesses in the model output. Minimal Pass B output
  // with only 1 why entry & 1 missing item should score low on raw quality,
  // triggering refinement even though post-processing would rescue it.
  const factSheet = validFactSheetPayload();
  const minimalPassB = validPayload({
    why: ['Executive Summary: The deal is workable given the defined deliverables.'],
    missing: ['What acceptance criteria apply? — determines payment trigger.'],
  });
  // Provide a 3rd mock for the refinement/regen attempt
  const betterPassB = validPayload({
    why: [
      'Executive Summary: The deal is workable given the defined deliverables.',
      'Decision Assessment: Several risk factors require attention.',
      'Negotiation Insights: Key leverage exists on timeline flexibility.',
      'Leverage Signals: Strong position on budget.',
      'Potential Deal Structures: Multiple viable structures.',
      'Decision Readiness: Ready pending clarification.',
      'Recommended Path: Proceed with conditions.',
    ],
    missing: [
      'What acceptance criteria apply? — determines payment trigger.',
      'What is the escalation path? — needed to manage risk.',
      'Who approves budget overruns? — affects negotiation ceiling.',
      'What is the cancellation clause? — determines exit cost.',
    ],
  });
  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(minimalPassB), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(betterPassB), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(betterPassB), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal covering project delivery and milestones.',
      confidentialText: 'Internal budget cap.',
      requestId: 'req-raw-quality-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // Minimal raw output should trigger refinement (raw quality < 1.0)
    assert.equal(outcome._internal.refinement.attempted, true,
      'Minimal raw output should trigger refinement attempt');
  } finally {
    cleanup();
  }
});

// ─── Quality upgrade: no unbounded retries ────────────────────────────────────

test('quality upgrade: at most one refinement + one regen — total calls bounded', async () => {
  const factSheet = validFactSheetPayload();
  const weakPassB = validPayload({
    why: ['Short.'],
    missing: ['Question.'],
  });

  let callCount = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 };
    }
    // All subsequent calls return the weak output to avoid infinite loops
    return { model: 'gemini-2.0-flash-001', text: JSON.stringify(weakPassB), finishReason: 'STOP', httpStatus: 200 };
  };

  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal text.',
      confidentialText: 'Confidential notes.',
      requestId: 'req-bounded-calls-1',
    });
    assert.equal(outcome.ok, true, 'Should succeed');
    // Pass A + Pass B + at most 1 refinement + at most 1 regen = 4 max
    assert.ok(callCount <= 4, `Expected at most 4 Vertex calls, got ${callCount}`);
    assert.ok(callCount >= 2, `Expected at least 2 Vertex calls (Pass A + Pass B), got ${callCount}`);
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

// ─── Quality upgrade: no regression in protected areas ────────────────────────

test('quality upgrade: refinement does not skip confidentiality enforcement', async () => {
  const factSheet = validFactSheetPayload();
  const initialPassB = validPayload({
    why: ['Executive Summary: Short.'],
    missing: ['Q1.'],
  });
  // Refined output leaks confidential text verbatim
  const leakyRefined = validPayload({
    fit_level: initialPassB.fit_level,
    confidence_0_1: initialPassB.confidence_0_1,
    why: [
      'Executive Summary: Internal budget of $500K noted privately means the project has significant funding that exceeds the visible commitment boundary.',
      'Decision Assessment: Risk areas.', 'Negotiation Insights: Insights.', 'Leverage Signals: Signals.',
      'Potential Deal Structures: Structures.', 'Decision Readiness: Readiness.', 'Recommended Path: Path.',
    ],
    missing: ['Q1? — reason.', 'Q2? — reason.', 'Q3? — reason.', 'Q4? — reason.'],
  });
  const cleanup = setVertexV2MockSequence([
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(factSheet), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(initialPassB), finishReason: 'STOP', httpStatus: 200 } },
    { response: { model: 'gemini-2.0-flash-001', text: JSON.stringify(leakyRefined), finishReason: 'STOP', httpStatus: 200 } },
  ]);
  // Mock the LLM verifier to return 'clean' so the flow reaches refinement
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__ = async () => ({
    model: 'gemini-2.0-flash-lite', text: '{"leak":false}', finishReason: 'STOP', httpStatus: 200,
  });
  try {
    const outcome = await evaluateMediationWithVertexV2({
      sharedText: 'Shared proposal text.',
      confidentialText: 'Internal budget of $500K noted privately.',
      enforceLeakGuard: true,
      requestId: 'req-refine-leak-guard-1',
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // Refinement should have been rejected because it leaks confidential text
    assert.equal(outcome._internal.refinement.applied, false, 'Leaky refinement must be rejected');
    assert.equal(outcome._internal.refinement.skip_reason, 'refinement_leaked_confidential');
    // Original output should be preserved
    const whyText = outcome.data.why.join(' ');
    assert.equal(whyText.includes('$500K'), false, 'Confidential budget must not appear in final output');
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__;
    cleanup();
  }
});
