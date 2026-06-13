/**
 * Model Routing Tests — vertex-evaluation-v2
 *
 * Proves:
 *   1. Pass B (generation) uses VERTEX_DOC_COMPARE_GENERATION_MODEL.
 *   2. The LLM verifier step uses VERTEX_DOC_COMPARE_VERIFIER_MODEL.
 *   3. Escalation fires when verifier returns invalid/unsure JSON.
 *   4. No 502: Vertex errors AND verifier errors both yield 200 + completed_with_warnings fallback.
 *
 * All tests run with NODE_ENV=test (set by npm run test:lib:integration).
 * Every test explicitly controls the Vertex call hooks:
 *   __PREMARKET_TEST_VERTEX_EVAL_V2_CALL__        — main generation + extract
 *   __PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__ — verifier step
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessReportQuality,
  evaluateWithVertexV2,
  validateResponseSchema,
} from '../../server/_lib/vertex-evaluation-v2.ts';
import { MEDIATION_REVIEW_STAGE, STAGE1_SHARED_INTAKE_STAGE } from '../../src/lib/opportunityReviewStage.js';

// ─── Input fixtures ───────────────────────────────────────────────────────────

const SHARED_TEXT = 'Shared contract draft: scope of analytics dashboard, 6-month timeline, standard SLA.';
const CONFIDENTIAL_TEXT = 'Confidential: internal budget cap $500k, renewal auto at 12 months.';

// A valid Pass A (fact-sheet) JSON response that passes validation.
function factSheetPayload() {
  return JSON.stringify({
    project_goal: 'Analytics dashboard delivery',
    scope_deliverables: ['Dashboard module', 'API integration'],
    timeline: { start: '2026-Q2', duration: '6 months', milestones: ['Alpha by Month 2'] },
    constraints: ['Budget cap applies'],
    success_criteria_kpis: ['Dashboard load < 2s'],
    vendor_preferences: [],
    assumptions: [],
    risks: [{ risk: 'Scope creep', impact: 'med', likelihood: 'med' }],
    open_questions: ['Confirm go-live date'],
    missing_info: [],
    source_coverage: {
      has_scope: true,
      has_timeline: true,
      has_kpis: true,
      has_constraints: true,
      has_risks: true,
    },
  });
}

function routingNarrative() {
  const topics = [
    'the dashboard module and API integration as the core commercial scope',
    'the six-month timetable and staged milestone sequence',
    'the performance target and evidence needed to assess progress',
    'renewal treatment and the ability to opt out before another term begins',
    'authority to approve scope changes and the financial effect of added work',
    'ownership of client and third-party dependencies that can move the timetable',
    'the connection between milestone acceptance and payment entitlement',
    'the escalation path when evidence, approval, or access arrives late',
    'the balance between a bounded first phase and possible later expansion',
    'the specific closing agenda needed before final documentation',
  ];
  const paragraphs = topics.map((topic, index) =>
    `The current proposal provides a useful starting point on ${topic}. The shared materials identify a dashboard engagement with a defined module, API work, a six-month horizon, and measurable performance expectations, so the recommendation is based on observable commercial terms rather than general optimism. This issue still needs careful treatment because the same wording could allocate cost, timing, or approval risk differently to each side. If the parties record the relevant owner, trigger, evidence, and exception before commitment, the phased structure can remain workable without creating open-ended exposure. If they leave it implicit, later implementation events may be interpreted as either an included obligation or an unapproved change. Analysis point ${index + 1} therefore supports proceeding only with conditions and explains what the next negotiation must resolve.`,
  );
  return {
    title: 'A workable dashboard engagement still needs its operating rules closed',
    sections: [
      { heading: 'Why the commercial logic is credible', paragraphs: paragraphs.slice(0, 2) },
      { heading: 'What the current record establishes', paragraphs: paragraphs.slice(2, 4) },
      { heading: 'Where risk could move between the parties', paragraphs: paragraphs.slice(4, 6) },
      { heading: 'A balanced route through the open terms', paragraphs: paragraphs.slice(6, 8) },
      { heading: 'What should be closed before commitment', paragraphs: paragraphs.slice(8, 10) },
    ],
    closing:
      'Hold one closing session to document renewal, change authority, dependency ownership, milestone evidence, payment triggers, and escalation before either side treats the engagement as ready for final approval.',
  };
}

// A valid Pass B (evaluation) JSON response.
function evalPayload(overrides = {}) {
  return JSON.stringify({
    analysis_stage: 'mediation_review',
    fit_level: 'medium',
    confidence_0_1: 0.71,
    why: [
      'Recommendation: Proceed with conditions because the dashboard engagement has a recognizable scope, timetable, and commercial purpose, but renewal treatment, approval authority, and milestone evidence still need agreement before final commitment. Resolving those terms would preserve the useful phased structure without asking either side to accept open-ended exposure.',
      'Where the Parties Align: Both sides appear to support the dashboard module, API integration, a six-month timetable, staged milestones, and measurable performance expectations. That alignment gives the parties a concrete basis for continuing the negotiation and linking payments to observable progress rather than a broad promise of completion.',
      'Where the Deal Is Stuck: Renewal opt-out rights, scope-change authority, dependency ownership, and the evidence required for milestone acceptance remain open. Those issues determine whether timing and payment remain predictable when implementation assumptions change or a third-party dependency delays the work.',
      'Suggested Bridge: Keep the phased engagement, name the person authorized to approve changes, tie milestone payments to agreed evidence, and add a clear renewal opt-out. A capped change process can preserve flexibility while preventing either side from treating unpriced expansion as part of the original commitment.',
      'Next Step: Hold a short closing session to settle renewal, change authority, milestone evidence, and dependency escalation before either side treats the engagement as ready for final documentation.',
    ],
    missing: [
      'Confirm budget ceiling is within approved range? — determines negotiation boundary.',
      'What is the auto-renewal opt-out provision? — affects long-term commitment risk.',
      'Who approves scope changes after signing? — needed to manage change orders.',
      'What are the acceptance criteria for each deliverable? — determines payment triggers.',
    ],
    redactions: [],
    narrative: routingNarrative(),
    ...overrides,
  });
}

function stage1Payload(overrides = {}) {
  return JSON.stringify({
    analysis_stage: 'stage1_shared_intake',
    submission_summary: 'The submitting party describes an initial proposal and needs the other side to respond.',
    scope_snapshot: ['The current materials describe only one side of the intended deal.'],
    unanswered_questions: ['What does the other side need clarified before responding?'],
    other_side_needed: ['The other side should provide its own priorities and constraints.'],
    discussion_starting_points: ['Clarify the submitted terms before bilateral mediation.'],
    intake_status: 'awaiting_other_side_input',
    basis_note:
      'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
    ...overrides,
  });
}

// ─── Hook helpers ─────────────────────────────────────────────────────────────

/** Records which preferredModel values were received by each Vertex call. */
function makeRecordingCallHook(sequence) {
  const calls = [];
  let idx = 0;
  const fn = async (params) => {
    calls.push({ preferredModel: params.preferredModel, idx });
    idx += 1;
    const step = sequence[idx - 1];
    if (!step) throw new Error(`No mock response at index ${idx - 1}`);
    if (step.throw) throw step.throw;
    return { model: step.model || 'mock-model', text: step.text || '', finishReason: 'STOP', httpStatus: 200 };
  };
  fn.calls = calls;
  return fn;
}

function setMainHook(fn) {
  const prev = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = fn;
  return () => {
    if (prev === undefined) delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    else globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = prev;
  };
}

function setVerifierHook(fn) {
  const prev = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__ = fn;
  return () => {
    if (prev === undefined) delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__;
    else globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__ = prev;
  };
}

function setOpenAIHook(fn) {
  const prev = globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = fn;
  return () => {
    if (prev === undefined) delete globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
    else globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = prev;
  };
}

function setEnv(key, value) {
  const prev = process.env[key];
  process.env[key] = value;
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

function clearEnv(key) {
  const prev = process.env[key];
  delete process.env[key];
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

function evaluateMediationWithVertexV2(input) {
  return evaluateWithVertexV2({
    analysisStage: MEDIATION_REVIEW_STAGE,
    ...input,
  });
}

function evaluateStage1WithVertexV2(input) {
  return evaluateWithVertexV2({
    analysisStage: STAGE1_SHARED_INTAKE_STAGE,
    ...input,
  });
}

// ─── Test 1: Generation call uses VERTEX_DOC_COMPARE_GENERATION_MODEL ─────────

await test('T1 — generation call uses VERTEX_DOC_COMPARE_GENERATION_MODEL', async () => {
  const routingFixtureQuality = assessReportQuality(
    JSON.parse(evalPayload()),
    JSON.parse(factSheetPayload()),
  );
  assert.equal(
    routingFixtureQuality.score,
    1,
    `Routing fixture should not trigger a quality-repair call: ${JSON.stringify(routingFixtureQuality)}`,
  );
  const normalizedFixture = validateResponseSchema(
    JSON.parse(evalPayload()),
    MEDIATION_REVIEW_STAGE,
  );
  assert.equal(normalizedFixture.ok, true);
  if (normalizedFixture.ok) {
    const normalizedQuality = assessReportQuality(
      normalizedFixture.normalized,
      JSON.parse(factSheetPayload()),
    );
    assert.equal(
      normalizedQuality.score,
      1,
      `Normalized routing fixture should not trigger a quality-repair call: ${JSON.stringify(normalizedQuality)}`,
    );
  }

  // Pass A (extract) gets factSheetPayload; Pass B (eval) gets evalPayload.
  const mainSequence = [
    { model: 'gemini-2.5-flash-lite', text: factSheetPayload() },  // Pass A
    { model: 'gemini-2.5-pro', text: evalPayload() },              // Pass B
  ];
  const mainCalls = [];
  const mainHook = async (params) => {
    mainCalls.push({ preferredModel: params.preferredModel });
    const step = mainCalls.length <= mainSequence.length ? mainSequence[mainCalls.length - 1] : null;
    if (!step) throw new Error('No mock response');
    return { model: step.model, text: step.text, finishReason: 'STOP', httpStatus: 200 };
  };

  const restoreMain = setMainHook(mainHook);
  const restoreEnvGen = setEnv('VERTEX_DOC_COMPARE_GENERATION_MODEL', 'gemini-2.5-pro');
  const restoreEnvExt = setEnv('VERTEX_DOC_COMPARE_EXTRACT_MODEL', 'gemini-2.5-flash-lite');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
    });

    assert.equal(result.ok, true, 'Expected ok:true result');
    assert.equal(result.generation_model, 'gemini-2.5-pro', 'generation_model field must reflect configured model');
    assert.ok(mainCalls.length >= 2, 'Expected at least 2 main calls (Pass A + Pass B)');

    // Pass B (last main call) should receive preferredModel = 'gemini-2.5-pro'
    const passBCall = mainCalls[mainCalls.length - 1];
    assert.equal(
      passBCall.preferredModel,
      'gemini-2.5-pro',
      `Pass B call must use generation model; got: ${passBCall.preferredModel}`,
    );

    // Pass A (first main call) should receive preferredModel = 'gemini-2.5-flash-lite'
    const passACall = mainCalls[0];
    assert.equal(
      passACall.preferredModel,
      'gemini-2.5-flash-lite',
      `Pass A call must use extract model; got: ${passACall.preferredModel}`,
    );

    // Internal models_used must be populated
    const modelsUsed = result._internal?.models_used;
    assert.ok(modelsUsed, 'Expected _internal.models_used to be set');
    assert.equal(modelsUsed.generation, 'gemini-2.5-pro');
    assert.equal(modelsUsed.extract, 'gemini-2.5-flash-lite');
  } finally {
    restoreMain();
    restoreEnvGen();
    restoreEnvExt();
  }
});

// ─── Test 2: Verifier uses VERTEX_DOC_COMPARE_VERIFIER_MODEL ─────────────────

await test('T2 — verifier step uses VERTEX_DOC_COMPARE_VERIFIER_MODEL', async () => {
  // Main hook: Pass A gets fact-sheet, Pass B gets eval.
  const mainSequence = [factSheetPayload(), evalPayload()];
  let mainIdx = 0;
  const mainHook = async () => {
    const text = mainIdx < mainSequence.length ? mainSequence[mainIdx] : evalPayload();
    mainIdx += 1;
    return { model: 'gemini-2.5-pro', text, finishReason: 'STOP', httpStatus: 200 };
  };

  // Verifier hook: record which model was requested, return clean result.
  const verifierCalls = [];
  const verifierHook = async (params) => {
    verifierCalls.push({ preferredModel: params.preferredModel });
    return {
      model: 'gemini-2.5-flash-lite',
      text: JSON.stringify({ leak: false, reason: 'No confidential content found in output.' }),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  const restoreMain = setMainHook(mainHook);
  const restoreVerifier = setVerifierHook(verifierHook);
  const restoreEnvVerifier = setEnv('VERTEX_DOC_COMPARE_VERIFIER_MODEL', 'gemini-2.5-flash-lite');
  const restoreEnvGen = setEnv('VERTEX_DOC_COMPARE_GENERATION_MODEL', 'gemini-2.5-pro');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: true, // enforceLeakGuard=true triggers the verifier
    });

    assert.equal(result.ok, true, 'Expected ok:true result');
    assert.ok(verifierCalls.length >= 1, 'Verifier should have been called at least once');

    const verifierCall = verifierCalls[0];
    assert.equal(
      verifierCall.preferredModel,
      'gemini-2.5-flash-lite',
      `Verifier call must use VERTEX_DOC_COMPARE_VERIFIER_MODEL; got: ${verifierCall.preferredModel}`,
    );

    // _internal.models_used.verifier should reflect the configured verifier model
    const modelsUsed = result._internal?.models_used;
    assert.ok(modelsUsed, '_internal.models_used must be set');
    assert.equal(modelsUsed.verifier, 'gemini-2.5-flash-lite');
    assert.equal(modelsUsed.verifier_used, true, 'verifier_used must be true when enforceLeakGuard=true');
  } finally {
    restoreMain();
    restoreVerifier();
    restoreEnvVerifier();
    restoreEnvGen();
  }
});

// ─── Test 3: Escalation fires when verifier returns invalid/unsure JSON ──────

await test('T3 — verifier escalation fires when verifier returns unsure/invalid JSON', async () => {
  const mainSequence = [factSheetPayload(), evalPayload()];
  let mainIdx = 0;
  const mainHook = async () => {
    const text = mainIdx < mainSequence.length ? mainSequence[mainIdx] : evalPayload();
    mainIdx += 1;
    return { model: 'gemini-2.5-pro', text, finishReason: 'STOP', httpStatus: 200 };
  };

  // Verifier hook tracks all calls and their preferredModel.
  const verifierCalls = [];
  const verifierHook = async (params) => {
    verifierCalls.push({ preferredModel: params.preferredModel });
    if (verifierCalls.length === 1) {
      // First call: verifier returns invalid JSON → triggers escalation
      return { model: 'gemini-2.5-flash-lite', text: 'NOT_JSON', finishReason: 'STOP', httpStatus: 200 };
    }
    // Second call: escalation — return clean to allow result to succeed
    return {
      model: params.preferredModel || 'gemini-2.5-pro',
      text: JSON.stringify({ leak: false, reason: 'No confidential content after deeper review.' }),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  const restoreMain = setMainHook(mainHook);
  const restoreVerifier = setVerifierHook(verifierHook);
  const restoreEnvVerifier = setEnv('VERTEX_DOC_COMPARE_VERIFIER_MODEL', 'gemini-2.5-flash-lite');
  const restoreEnvGen = setEnv('VERTEX_DOC_COMPARE_GENERATION_MODEL', 'gemini-2.5-pro');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: true,
    });

    // Verifier hook must have been called twice: initial + escalation
    assert.equal(verifierCalls.length, 2, `Expected 2 verifier calls (initial + escalation); got ${verifierCalls.length}`);

    // First call uses verifier model
    assert.equal(
      verifierCalls[0].preferredModel,
      'gemini-2.5-flash-lite',
      `Initial verifier call must use verifier model; got: ${verifierCalls[0].preferredModel}`,
    );

    // Second call (escalation) uses generation model
    assert.equal(
      verifierCalls[1].preferredModel,
      'gemini-2.5-pro',
      `Escalation call must use generation model; got: ${verifierCalls[1].preferredModel}`,
    );

    // Main hook must still only have been called for Pass A + Pass B
    assert.equal(mainIdx, 2, `Main hook should only be called 2 times (Pass A + Pass B); got ${mainIdx}`);

    // Result must be ok:true
    assert.equal(result.ok, true, 'Must be ok:true even after escalation');

    // _internal.models_used.verifier_escalated = true
    const modelsUsed = result._internal?.models_used;
    assert.ok(modelsUsed, '_internal.models_used must be set');
    assert.equal(modelsUsed.verifier_escalated, true, 'verifier_escalated must be true after unsure response');
  } finally {
    restoreMain();
    restoreVerifier();
    restoreEnvVerifier();
    restoreEnvGen();
  }
});

// ─── Test 4: No 502 when Vertex errors AND verifier errors ────────────────────

await test('T4 — no 502: Vertex throw + verifier throw both produce ok:true fallback', async () => {
  // Main hook: Pass A throws, Pass B throws → triggers fallback path.
  let mainCallCount = 0;
  const mainHook = async () => {
    mainCallCount += 1;
    throw Object.assign(new Error('Simulated Vertex 503'), {
      code: 'vertex_http_error',
      statusCode: 503,
      extra: { upstreamStatus: 503, upstreamMessage: 'Service Unavailable' },
    });
  };

  // Verifier also throws.
  let verifierCallCount = 0;
  const verifierHook = async () => {
    verifierCallCount += 1;
    throw new Error('Simulated verifier network failure');
  };

  const restoreMain = setMainHook(mainHook);
  const restoreVerifier = setVerifierHook(verifierHook);
  const restoreEnvGen = setEnv('VERTEX_DOC_COMPARE_GENERATION_MODEL', 'gemini-2.5-pro');

  try {
    // Must not throw — "never fail" guarantee
    let result;
    try {
      result = await evaluateMediationWithVertexV2({
        sharedText: SHARED_TEXT,
        confidentialText: CONFIDENTIAL_TEXT,
        enforceLeakGuard: true,
      });
    } catch (err) {
      assert.fail(`evaluateWithVertexV2 must never throw a network error to the caller; got: ${err?.message}`);
    }

    assert.ok(result, 'Expected a result object');
    assert.equal(result.ok, true, `Expected ok:true fallback result; got ok:${result.ok}`);
    assert.ok(Array.isArray(result.data?.why) && result.data.why.length > 0, 'Fallback must include why[]');
    assert.ok(typeof result.data?.confidence_0_1 === 'number', 'Fallback must include numeric confidence_0_1');

    // generation_model must still be set even on fallback
    assert.equal(result.generation_model, 'gemini-2.5-pro', 'generation_model must be set on fallback result');

    // _internal.failure_kind must indicate the fallback was triggered by an error
    const internal = result._internal;
    assert.ok(internal?.failure_kind, 'Expected _internal.failure_kind to be set on fallback');
    assert.ok(
      ['vertex_http_error', 'vertex_timeout', 'json_parse_error', 'schema_validation_error', 'empty_output', 'truncated_output'].includes(
        internal.failure_kind,
      ),
      `Unexpected failure_kind: ${internal.failure_kind}`,
    );

    // Verifier was NOT called because Pass B never succeeded
    // (the verifier only runs after a successful schema validation).
    // This confirms the never-fail path doesn't hang waiting for a verifier.
    assert.equal(verifierCallCount, 0, 'Verifier should not have been called when Pass B never succeeded');
  } finally {
    restoreMain();
    restoreVerifier();
    restoreEnvGen();
  }
});

// ─── Test D1: Verifier unavailable → output suppressed, never 5xx ─────────────

await test('D1 — verifier unavailable: output suppressed, ok:true, verifier_unavailable warning', async () => {
  // Pass A + Pass B succeed normally.
  const mainSequence = [factSheetPayload(), evalPayload()];
  let mainIdx = 0;
  const mainHook = async () => {
    const text = mainIdx < mainSequence.length ? mainSequence[mainIdx] : evalPayload();
    mainIdx += 1;
    return { model: 'gemini-2.5-pro', text, finishReason: 'STOP', httpStatus: 200 };
  };

  // Verifier throws on every call (initial + escalation) → 'unavailable' verdict.
  let verifierCallCount = 0;
  const verifierHook = async () => {
    verifierCallCount += 1;
    throw new Error('Simulated verifier network timeout');
  };

  const restoreMain = setMainHook(mainHook);
  const restoreVerifier = setVerifierHook(verifierHook);
  const restoreEnvGen = setEnv('VERTEX_DOC_COMPARE_GENERATION_MODEL', 'gemini-2.5-pro');
  const restoreEnvVerifier = setEnv('VERTEX_DOC_COMPARE_VERIFIER_MODEL', 'gemini-2.5-flash-lite');

  try {
    let result;
    try {
      result = await evaluateMediationWithVertexV2({
        sharedText: SHARED_TEXT,
        confidentialText: CONFIDENTIAL_TEXT,
        enforceLeakGuard: true,
      });
    } catch (err) {
      assert.fail(`evaluateWithVertexV2 must never throw when verifier is unavailable; got: ${err?.message}`);
    }

    // Policy: verifier down → ok:true suppressed, never 5xx.
    assert.equal(result.ok, true, 'Expected ok:true when verifier is unavailable');
    assert.equal(result.data?.fit_level, 'unknown', 'fit_level must be "unknown" (suppressed placeholder)');
    assert.equal(result.data?.confidence_0_1, 0, 'confidence_0_1 must be 0 (suppressed placeholder)');

    // Warning must identify the cause.
    const warnings = result._internal?.warnings ?? [];
    assert.ok(
      warnings.includes('verifier_unavailable_output_suppressed'),
      `Expected 'verifier_unavailable_output_suppressed' in warnings; got: ${JSON.stringify(warnings)}`,
    );

    // failure_kind must be set to verifier_unavailable.
    assert.equal(
      result._internal?.failure_kind,
      'verifier_unavailable',
      `Expected failure_kind='verifier_unavailable'; got: ${result._internal?.failure_kind}`,
    );

    // models_used must track the unavailability.
    const modelsUsed = result._internal?.models_used;
    assert.ok(modelsUsed, '_internal.models_used must be set');
    assert.equal(modelsUsed.verifier_used, true, 'verifier_used must be true (verifier was attempted)');
    assert.equal(modelsUsed.verifier_unavailable, true, 'verifier_unavailable must be true');

    // Suppressed output must not contain any confidential text.
    const outputText = JSON.stringify(result.data ?? {});
    assert.ok(
      !outputText.includes('500k') && !outputText.includes('renewal auto'),
      'Suppressed output must not contain confidential canary text',
    );
  } finally {
    restoreMain();
    restoreVerifier();
    restoreEnvGen();
    restoreEnvVerifier();
  }
});

// ─── Test D2: Leak detected by LLM verifier → ok:true suppressed, never 5xx ──

await test('D2 — leak detected by LLM verifier: ok:true suppressed result, no 5xx, no leaked content', async () => {
  // Pass A + Pass B succeed normally.
  const mainSequence = [factSheetPayload(), evalPayload()];
  let mainIdx = 0;
  const mainHook = async () => {
    const text = mainIdx < mainSequence.length ? mainSequence[mainIdx] : evalPayload();
    mainIdx += 1;
    return { model: 'gemini-2.5-pro', text, finishReason: 'STOP', httpStatus: 200 };
  };

  // Verifier returns leak=true on the first call.
  let verifierCallCount = 0;
  const verifierHook = async () => {
    verifierCallCount += 1;
    return {
      model: 'gemini-2.5-flash-lite',
      text: JSON.stringify({ leak: true, reason: 'Output contains budget cap figure from confidential input.' }),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  const restoreMain = setMainHook(mainHook);
  const restoreVerifier = setVerifierHook(verifierHook);
  const restoreEnvGen = setEnv('VERTEX_DOC_COMPARE_GENERATION_MODEL', 'gemini-2.5-pro');
  const restoreEnvVerifier = setEnv('VERTEX_DOC_COMPARE_VERIFIER_MODEL', 'gemini-2.5-flash-lite');

  try {
    let result;
    try {
      result = await evaluateMediationWithVertexV2({
        sharedText: SHARED_TEXT,
        confidentialText: CONFIDENTIAL_TEXT,
        enforceLeakGuard: true,
      });
    } catch (err) {
      assert.fail(`evaluateWithVertexV2 must never throw when leak is detected; got: ${err?.message}`);
    }

    // Policy: leak detected → ok:true suppressed, never 5xx (was: ok:false hard failure).
    assert.equal(result.ok, true, 'Expected ok:true when leak is detected (not a user-visible failure)');
    assert.equal(result.data?.fit_level, 'unknown', 'fit_level must be "unknown" (suppressed placeholder)');
    assert.equal(result.data?.confidence_0_1, 0, 'confidence_0_1 must be 0 (suppressed placeholder)');

    // Warning must identify the cause.
    const warnings = result._internal?.warnings ?? [];
    assert.ok(
      warnings.includes('confidential_leak_detected_output_suppressed'),
      `Expected 'confidential_leak_detected_output_suppressed' in warnings; got: ${JSON.stringify(warnings)}`,
    );

    // failure_kind must be confidential_leak_detected.
    assert.equal(
      result._internal?.failure_kind,
      'confidential_leak_detected',
      `Expected failure_kind='confidential_leak_detected'; got: ${result._internal?.failure_kind}`,
    );

    // models_used must confirm verifier was used and no unavailability.
    const modelsUsed = result._internal?.models_used;
    assert.ok(modelsUsed, '_internal.models_used must be set');
    assert.equal(modelsUsed.verifier_used, true, 'verifier_used must be true');
    assert.equal(modelsUsed.verifier_unavailable, false, 'verifier_unavailable must be false (leak was detected, not an error)');

    // Suppressed output must not contain any confidential text.
    const outputText = JSON.stringify(result.data ?? {});
    assert.ok(
      !outputText.includes('500k') && !outputText.includes('renewal auto'),
      'Suppressed output must not contain confidential canary text',
    );
  } finally {
    restoreMain();
    restoreVerifier();
    restoreEnvGen();
    restoreEnvVerifier();
  }
});

// ─── OpenAI mediation-family provider routing ────────────────────────────────

await test('O1 — first bilateral mediation review uses OpenAI when MEDIATION_AI_PROVIDER=openai', async () => {
  const openAICalls = [];
  const openAIHook = async (params) => {
    openAICalls.push(params);
    const text = openAICalls.length === 1 ? factSheetPayload() : evalPayload();
    return { model: params.preferredModel || 'gpt-openai-test', text, finishReason: 'STOP', httpStatus: 200 };
  };
  const vertexHook = async () => {
    throw new Error('Vertex should not be called for OpenAI-routed mediation reviews');
  };

  const restoreOpenAI = setOpenAIHook(openAIHook);
  const restoreVertex = setMainHook(vertexHook);
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreModel = setEnv('MEDIATION_AI_MODEL', 'gpt-openai-test');
  const restoreKey = setEnv('OPENAI_API_KEY', 'test-openai-key');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.generation_model, 'gpt-openai-test');
    assert.equal(result.model, 'gpt-openai-test');
    assert.equal(result._internal?.models_used?.provider, 'openai');
    assert.equal(openAICalls.length, 2, 'OpenAI should handle Pass A and Pass B');
    assert.equal(result._internal?.runtime?.model_call_count, 2);
    assert.equal(result._internal?.runtime?.quality_repair_call_count, 0);
    assert.equal(typeof result._internal?.narrative_validation?.word_count, 'number');
    assert.equal(openAICalls[0].preferredModel, 'gpt-openai-test');
    assert.equal(openAICalls[1].preferredModel, 'gpt-openai-test');
  } finally {
    restoreOpenAI();
    restoreVertex();
    restoreProvider();
    restoreModel();
    restoreKey();
  }
});

await test('O1b — OpenAI timeout is not retried by the evaluator and returns a bounded fallback', async () => {
  let openAICalls = 0;
  const openAIHook = async () => {
    openAICalls += 1;
    const error = new Error('OpenAI mediation request timed out');
    error.code = 'openai_timeout';
    error.statusCode = 504;
    throw error;
  };

  const restoreOpenAI = setOpenAIHook(openAIHook);
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreModel = setEnv('MEDIATION_AI_MODEL', 'gpt-openai-timeout');
  const restoreKey = setEnv('OPENAI_API_KEY', 'test-openai-key');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
      executionDeadlineMs: Date.now() + 270_000,
      maxQualityRepairCalls: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(openAICalls, 2, 'Fact extraction and generation each get one bounded attempt');
    assert.equal(result._internal?.failure_kind, 'openai_timeout');
    assert.equal(result._internal?.runtime?.model_call_count, 2);
    assert.equal(result._internal?.runtime?.quality_repair_call_count, 0);
    assert.equal(result._internal?.narrative_validation?.renderer_path, 'fallback');
  } finally {
    restoreOpenAI();
    restoreProvider();
    restoreModel();
    restoreKey();
  }
});

await test('O2 — later progress-aware mediation review also uses OpenAI when MEDIATION_AI_PROVIDER=openai', async () => {
  const openAICalls = [];
  const openAIHook = async (params) => {
    openAICalls.push(params);
    const text = openAICalls.length === 1
      ? factSheetPayload()
      : evalPayload({
          bilateral_round_number: 2,
          prior_bilateral_round_id: 'eval-prev-1',
          prior_bilateral_round_number: 1,
          delta_summary: 'Commercial terms have narrowed since the prior mediation review.',
          resolved_since_last_round: ['Timeline'],
          remaining_deltas: ['Pricing'],
          new_open_issues: [],
          movement_direction: 'converging',
        });
    return { model: params.preferredModel || 'gpt-openai-progress', text, finishReason: 'STOP', httpStatus: 200 };
  };
  const vertexHook = async () => {
    throw new Error('Vertex should not be called for progress-aware OpenAI mediation reviews');
  };

  const restoreOpenAI = setOpenAIHook(openAIHook);
  const restoreVertex = setMainHook(vertexHook);
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreModel = setEnv('MEDIATION_AI_MODEL', 'gpt-openai-progress');
  const restoreKey = setEnv('OPENAI_API_KEY', 'test-openai-key');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
      mediationRoundContext: {
        current_bilateral_round_number: 2,
        prior_bilateral_round_id: 'eval-prev-1',
        prior_bilateral_round_number: 1,
        prior_primary_insight: 'Pricing remained open in the prior round.',
        prior_missing: ['What is the pricing model?'],
        prior_bridgeability_notes: ['Tie price to milestone risk.'],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result._internal?.models_used?.provider, 'openai');
    assert.equal(openAICalls.length >= 2, true, 'OpenAI should handle the progress-aware mediation calls');
    assert.equal(
      openAICalls.some((call) => String(call.prompt || '').includes('prior_bilateral_context')),
      true,
      'OpenAI Pass B prompt should include prior bilateral context for progress-aware mediation',
    );
  } finally {
    restoreOpenAI();
    restoreVertex();
    restoreProvider();
    restoreModel();
    restoreKey();
  }
});

for (const providerValue of [undefined, '', 'vertex', 'gemini', 'unknown-provider']) {
  await test(`O3 — mediation uses existing Vertex path when MEDIATION_AI_PROVIDER=${providerValue ?? 'unset'}`, async () => {
    const mainSequence = [factSheetPayload(), evalPayload()];
    const vertexCalls = [];
    const vertexHook = async (params) => {
      vertexCalls.push(params);
      const step = mainSequence[vertexCalls.length - 1];
      if (!step) return { model: 'gemini-2.5-pro', text: evalPayload(), finishReason: 'STOP', httpStatus: 200 };
      return { model: 'gemini-2.5-pro', text: step, finishReason: 'STOP', httpStatus: 200 };
    };
    const openAIHook = async () => {
      throw new Error('OpenAI should not be called unless MEDIATION_AI_PROVIDER=openai');
    };

    const restoreVertex = setMainHook(vertexHook);
    const restoreOpenAI = setOpenAIHook(openAIHook);
    const restoreProvider = providerValue === undefined
      ? clearEnv('MEDIATION_AI_PROVIDER')
      : setEnv('MEDIATION_AI_PROVIDER', providerValue);

    try {
      const result = await evaluateMediationWithVertexV2({
        sharedText: SHARED_TEXT,
        confidentialText: CONFIDENTIAL_TEXT,
        enforceLeakGuard: false,
      });

      assert.equal(result.ok, true);
      assert.equal(result._internal?.models_used?.provider, 'vertex');
      assert.equal(vertexCalls.length, 2, 'Vertex should handle Pass A and Pass B');
    } finally {
      restoreVertex();
      restoreOpenAI();
      restoreProvider();
    }
  });
}

await test('O4 — Stage 1 remains on Vertex even when MEDIATION_AI_PROVIDER=openai', async () => {
  const vertexSequence = [factSheetPayload(), stage1Payload()];
  const vertexCalls = [];
  const vertexHook = async (params) => {
    vertexCalls.push(params);
    return { model: 'gemini-2.5-pro', text: vertexSequence[vertexCalls.length - 1], finishReason: 'STOP', httpStatus: 200 };
  };
  const openAIHook = async () => {
    throw new Error('OpenAI should not be called for Stage 1');
  };

  const restoreVertex = setMainHook(vertexHook);
  const restoreOpenAI = setOpenAIHook(openAIHook);
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreKey = clearEnv('OPENAI_API_KEY');

  try {
    const result = await evaluateStage1WithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.data?.analysis_stage, 'stage1_shared_intake');
    assert.equal(result._internal?.models_used?.provider, 'vertex');
    assert.equal(vertexCalls.length, 2, 'Stage 1 should still use Vertex Pass A and Pass B');
  } finally {
    restoreVertex();
    restoreOpenAI();
    restoreProvider();
    restoreKey();
  }
});

await test('O5 — missing OPENAI_API_KEY throws a clear error only for OpenAI-routed mediation', async () => {
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreKey = clearEnv('OPENAI_API_KEY');
  const restoreOpenAI = (() => {
    const prev = globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
    delete globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
    return () => {
      if (prev === undefined) delete globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
      else globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = prev;
    };
  })();

  try {
    await assert.rejects(
      evaluateMediationWithVertexV2({
        sharedText: SHARED_TEXT,
        confidentialText: CONFIDENTIAL_TEXT,
        enforceLeakGuard: false,
      }),
      (error) => {
        assert.equal(error?.code, 'openai_not_configured');
        assert.match(String(error?.message || ''), /MEDIATION_AI_PROVIDER=openai requires OPENAI_API_KEY/i);
        return true;
      },
    );
  } finally {
    restoreProvider();
    restoreKey();
    restoreOpenAI();
  }
});

await test('O6 — OpenAI mediation defaults to GPT-5.4 when MEDIATION_AI_MODEL is unset', async () => {
  const openAICalls = [];
  const openAIHook = async (params) => {
    openAICalls.push(params);
    const text = openAICalls.length === 1 ? factSheetPayload() : evalPayload();
    return { model: params.preferredModel || 'gpt-5.4', text, finishReason: 'STOP', httpStatus: 200 };
  };
  const vertexHook = async () => {
    throw new Error('Vertex should not be called for OpenAI-routed mediation reviews');
  };

  const restoreOpenAI = setOpenAIHook(openAIHook);
  const restoreVertex = setMainHook(vertexHook);
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreModel = clearEnv('MEDIATION_AI_MODEL');
  const restoreKey = setEnv('OPENAI_API_KEY', 'test-openai-key');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.generation_model, 'gpt-5.4');
    assert.equal(result._internal?.models_used?.provider, 'openai');
    assert.equal(openAICalls.length, 2, 'OpenAI should handle Pass A and Pass B');
    assert.equal(openAICalls[0].preferredModel, 'gpt-5.4');
    assert.equal(openAICalls[1].preferredModel, 'gpt-5.4');
  } finally {
    restoreOpenAI();
    restoreVertex();
    restoreProvider();
    restoreModel();
    restoreKey();
  }
});

await test('O7 — OpenAI insufficient quota is recorded, not retried, and returns an explicit fallback', async () => {
  let openAICalls = 0;
  const openAIHook = async () => {
    openAICalls += 1;
    const error = new Error('OpenAI mediation request failed');
    error.code = 'openai_request_failed';
    error.statusCode = 502;
    error.extra = {
      upstreamStatus: 429,
      upstreamCode: 'insufficient_quota',
      upstreamMessage: 'You exceeded your current quota.',
    };
    throw error;
  };

  const restoreOpenAI = setOpenAIHook(openAIHook);
  const restoreProvider = setEnv('MEDIATION_AI_PROVIDER', 'openai');
  const restoreModel = setEnv('MEDIATION_AI_MODEL', 'gpt-5.4');
  const restoreKey = setEnv('OPENAI_API_KEY', 'test-openai-key');

  try {
    const result = await evaluateMediationWithVertexV2({
      sharedText: SHARED_TEXT,
      confidentialText: CONFIDENTIAL_TEXT,
      enforceLeakGuard: false,
    });

    assert.equal(result.ok, true);
    assert.equal(openAICalls, 2, 'Quota failure should make one fact extraction call and one generation call without retry');
    assert.equal(result._internal?.failure_kind, 'openai_quota_exceeded');
    assert.equal(result._internal?.fallback_mode, 'incomplete');
    assert.equal(result._internal?.failure_details?.provider_status, 429);
    assert.equal(result._internal?.failure_details?.provider_code, 'insufficient_quota');
    assert.equal(result._internal?.models_used?.provider, 'openai');
    assert.equal(result._internal?.narrative_validation?.renderer_path, 'fallback');
    assert.equal(result._internal?.narrative_validation?.valid, false);
    assert.equal(
      result._internal?.warnings?.includes('openai_quota_exceeded_fallback_used'),
      true,
    );
  } finally {
    restoreOpenAI();
    restoreProvider();
    restoreModel();
    restoreKey();
  }
});
