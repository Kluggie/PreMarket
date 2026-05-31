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
import { evaluateWithVertexV2 } from '../../server/_lib/vertex-evaluation-v2.ts';
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

// A valid Pass B (evaluation) JSON response.
function evalPayload(overrides = {}) {
  return JSON.stringify({
    fit_level: 'medium',
    confidence_0_1: 0.71,
    why: [
      'Executive Summary: Scope aligns with internal requirements and the proposal demonstrates a clear understanding of the expected deliverables, timelines, and resource allocation needed for successful project execution.',
      'Decision Assessment: Several factors affect the readiness of this deal, including the clarity of deliverables, the timeline feasibility, and the alignment between stated objectives and proposed resource allocation.',
      'Negotiation Insights: The vendor has structured their proposal with flexibility on timeline adjustments, which provides meaningful leverage for discussions about phased delivery milestones and payment schedules.',
      'Leverage Signals: Budget parameters and delivery expectations create natural negotiation leverage, particularly around milestone-based payment structures and performance guarantees that protect both parties.',
      'Potential Deal Structures: Multiple viable structures exist including fixed-price with milestone payments, time-and-materials with a cap, or a hybrid approach that balances risk between the parties.',
      'Decision Readiness: Near-ready pending renewal clarification and a few outstanding questions that should be resolved before final commitment to ensure both parties are aligned on scope boundaries.',
      'Recommended Path: Add renewal opt-out language before signing, negotiate milestone-based payments, and establish clear acceptance criteria to protect both buyer and vendor interests.',
    ],
    missing: [
      'Confirm budget ceiling is within approved range? — determines negotiation boundary.',
      'What is the auto-renewal opt-out provision? — affects long-term commitment risk.',
      'Who approves scope changes after signing? — needed to manage change orders.',
      'What are the acceptance criteria for each deliverable? — determines payment triggers.',
    ],
    redactions: [],
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
