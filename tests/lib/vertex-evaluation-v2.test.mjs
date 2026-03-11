import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  evaluateWithVertexV2,
  validateResponseSchema,
  computeReportStyleSeed,
  selectReportStyle,
} from '../../server/_lib/vertex-evaluation-v2.ts';

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
    fit_level: 'medium',
    confidence_0_1: 0.73,
    why: ['Shared obligations align with internal constraints.'],
    missing: ['Clarify renewal terms in shared draft.'],
    redactions: ['Internal budget assumptions'],
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
  const good = validateResponseSchema(validPayload());
  assert.equal(good.ok, true);

  const missing = validateResponseSchema({
    fit_level: 'medium',
    confidence_0_1: 0.6,
    why: ['ok'],
    missing: [],
  });
  assert.equal(missing.ok, false);
  assert.equal(Array.isArray(missing.missingKeys), true);
  assert.equal(missing.missingKeys.includes('redactions'), true);
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
        text: JSON.stringify(validPayload({ fit_level: 'high', confidence_0_1: 0.9 })),
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared commitments include milestones and support obligations.',
      confidentialText: 'Internal constraints include delivery limits and governance controls.',
      requestId: 'req-valid-1',
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // Full-coverage fact sheet → no clamps → high / 0.9 preserved
    assert.equal(outcome.data.fit_level, 'high');
    assert.equal(outcome.data.confidence_0_1, 0.9);
    assert.equal(outcome.attempt_count, 1);
    assert.equal(typeof outcome.model, 'string');
  } finally {
    cleanup();
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
      outcome.data.why.some((entry) => entry.includes('Paths to agreement') || entry.includes('Conditionally viable')),
      'salvaged fallback should return a substantive negotiator memo',
    );
    assert.ok(Array.isArray(outcome.data.missing) && outcome.data.missing.length >= 3,
      'fallback must provide at least 3 missing items');
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    assert.equal(whyText.includes('Assessment incomplete'), true, 'incomplete fallback body must say the assessment is incomplete');
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
    const outcome = await evaluateWithVertexV2({
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
    passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.6 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    await evaluateWithVertexV2({
      sharedText: 'Shared proposal text: deliver analytics dashboard by Q3.',
      confidentialText: 'Confidential: budget is $200k, team of 5 engineers.',
      requestId: 'req-sanity-prompt-1',
    });

    assert.equal(callCount, 2, 'Two Vertex calls must be made (Pass A + Pass B)');

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

    // Pass B prompt: must state proposal-quality objective
    assert.equal(
      passBPrompt.includes('evaluate the overall business proposal quality'),
      true,
      'Pass B prompt must state proposal-quality objective',
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared: deliver analytics module with SLA definitions.',
      confidentialText: 'Confidential: budget is fixed, approved vendor list applies.',
      requestId: 'req-2pass-calls-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    assert.equal(calls.length, 2, 'Exactly two Vertex calls must be made');

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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    assert.equal(caps.includes('cap_0.62_material_uncertainty'), false, 'material-uncertainty cap must not fire');
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
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared proposal defines MVP modules, milestones, and headline success metrics.',
      confidentialText: 'Confidential notes mention legacy data cleanup and customer-side remediation ownership.',
      requestId: 'req-conditional-calibration-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.fit_level, 'medium', 'material unresolved risk should force a conditional medium verdict');
    assert.equal(outcome.data.confidence_0_1 <= 0.58, true, 'confidence must not remain near 0.95 when contradictions remain');
    assert.equal(
      outcome._internal?.caps_applied.includes('downgrade_high_material_uncertainty'),
      true,
      'material-uncertainty downgrade must be recorded',
    );
    assert.equal(
      outcome._internal?.caps_applied.includes('cap_0.58_contradiction_confidence'),
      true,
      'contradiction confidence cap must be recorded',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Conditionally viable') || entry.includes('Decision readiness is conditional')),
      true,
      'Decision language must be rewritten to a conditional posture',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Conditions to proceed')),
      true,
      'Recommendations must front-load the conditions to proceed',
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
    const outcome = await evaluateWithVertexV2({
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
      outcome.data.why.some((entry) => entry.includes('Areas of alignment include') || entry.includes('Alignment exists around')),
      true,
      'Key Strengths should be reframed as bilateral alignment',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Paths to agreement')),
      true,
      'Recommendations should include a bridge-to-agreement path',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Next negotiation agenda')),
      true,
      'Recommendations should include a next negotiation agenda',
    );
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('What must be agreed now vs later')),
      true,
      'Decision Readiness should distinguish what must be fixed now versus deferred',
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
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared proposal covers preventive maintenance visits, emergency callout coverage, and monthly reporting for two sites.',
      confidentialText: 'Confidential notes mention access approvals and change-order assumptions.',
      requestId: 'req-generalization-service-medium-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    assert.equal(outcome.data.fit_level, 'medium', 'a workable non-software proposal should normalize to medium when the issue is boundedness, not viability');
    assert.equal(
      outcome.data.why.some((entry) => entry.includes('Conditionally viable') || entry.includes('workable starting point')),
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
      whyText.includes('tighter commitment boundary') || whyText.includes('not yet bounded tightly enough'),
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
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared proposal covers preventive maintenance, emergency callouts, monthly reporting, milestones, and response targets.',
      confidentialText: 'Confidential notes mention access approvals and rework caveats.',
      requestId: 'req-presentation-strengths-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    if (!outcome.ok) return;

    const strengthsEntry = outcome.data.why.find((entry) => entry.startsWith('Key Strengths:')) || '';
    assert.equal(strengthsEntry.includes('Areas of alignment include'), true, 'Key Strengths should lead with concrete alignment points');
    assert.equal(
      strengthsEntry.includes('The current materials also provide') || strengthsEntry.includes('Those positives matter because'),
      true,
      'Key Strengths should add a second concrete point when the fact sheet supports it',
    );
    assert.equal(
      /clear and specific|well thought out|clear\./i.test(strengthsEntry),
      false,
      'Key Strengths should not collapse into generic praise',
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Deliver analytics module with 6-month timeline, KPIs, risks, and constraints documented.',
      confidentialText: 'Confidential: budget is fixed at approved level, vendor review has occurred.',
      requestId: 'req-style-prompt-1',
    });

    assert.equal(outcome.ok, true, 'Should succeed');
    assert.equal(callCount, 2, 'Two Vertex calls must be made');

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

test('style: has_timeline=false → "Implementation Notes" not instructed; has_timeline=true → it is', async () => {
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
      passBPrompt = prompt;
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    };
    await evaluateWithVertexV2({
      sharedText: 'Deliver analytics module with specified KPIs, risks, and constraints.',
      confidentialText: 'Confidential: budget and governance details provided.',
      requestId: 'req-style-modules-1',
    });
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    return passBPrompt;
  }

  // has_timeline=false → Implementation Notes must NOT be instructed
  const promptNoTimeline = await capturePassBPrompt({
    source_coverage: { has_scope: true, has_timeline: false, has_kpis: true, has_constraints: true, has_risks: true },
    vendor_preferences: [],
  });
  assert.equal(
    promptNoTimeline.includes('Implementation Notes'),
    false,
    'Implementation Notes must not appear in Pass B prompt when has_timeline=false',
  );

  // has_timeline=true → Implementation Notes must be instructed
  const promptWithTimeline = await capturePassBPrompt({
    source_coverage: { has_scope: true, has_timeline: true, has_kpis: true, has_constraints: true, has_risks: true },
    vendor_preferences: [],
  });
  assert.equal(
    promptWithTimeline.includes('Implementation Notes'),
    true,
    'Implementation Notes must appear in Pass B prompt when has_timeline=true',
  );
});

test('style: vendor_preferences empty → "Vendor Fit Notes" absent; non-empty → present', async () => {
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
      passBPrompt = prompt;
      return {
        model: 'gemini-2.0-flash-001',
        text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    };
    await evaluateWithVertexV2({
      sharedText: 'Deliver analytics module with KPIs, timeline, risks, and constraints defined.',
      confidentialText: 'Confidential: budget and governance details provided.',
      requestId: 'req-style-vendor-1',
    });
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    return passBPrompt;
  }

  // No vendor preferences → Vendor Fit Notes must NOT be instructed
  const promptNoVendor = await capturePassBPrompt({ vendor_preferences: [] });
  assert.equal(
    promptNoVendor.includes('Vendor Fit Notes'),
    false,
    'Vendor Fit Notes must not appear when vendor_preferences is empty',
  );

  // Vendor preferences present → Vendor Fit Notes must be instructed
  const promptWithVendor = await capturePassBPrompt({
    vendor_preferences: ['Preferred: AWS', 'Excluded: on-premise only vendors'],
  });
  assert.equal(
    promptWithVendor.includes('Vendor Fit Notes'),
    true,
    'Vendor Fit Notes must appear in Pass B prompt when vendor_preferences is non-empty',
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
      const outcome = await evaluateWithVertexV2({
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
          'Executive Summary': ['Executive Summary', 'Snapshot'],
          'Risk Summary': ['Risk Summary', 'Key Risks'],
        };
        for (const heading of exp.mustContainHeadings) {
          const acceptable = headingAliases[heading] || [heading];
          const found = acceptable.some((candidate) =>
            outcome.data.why.some((s) => s.toLowerCase().includes(candidate.toLowerCase())),
          );
          assert.equal(found, true, `[${fixture.name}] why[] must contain heading '${heading}'`);
        }
      }

      // ── optional headings in Pass B prompt (conditional logic) ──────────
      if (Array.isArray(exp.shouldIncludeOptionalHeadings)) {
        for (const heading of exp.shouldIncludeOptionalHeadings) {
          assert.equal(
            passBPrompt.includes(heading),
            true,
            `[${fixture.name}] Pass B prompt must instruct optional heading '${heading}'`,
          );
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
    const outcome = await evaluateWithVertexV2({
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
    passBPrompt = params.prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.7 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
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
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared proposal with phased deliverables, timeline, and KPI references.',
      confidentialText: 'Confidential notes mention data remediation and commercial caveats.',
      requestId: 'req-truncation-guard-1',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    if (!outcome.ok) return;

    const whyText = outcome.data.why.join('\n');
    const totalChars = outcome.data.why.reduce((sum, entry) => sum + entry.length + 1, 0);
    assert.equal(totalChars <= 3000, true, 'why[] must still respect the max character budget');
    assert.equal(whyText.includes('…'), false, 'truncation must drop content instead of blind character slicing');
    assert.equal(/Conditions to proc(?!eed)/i.test(whyText), false, 'Conditions to proceed prefix must not be cut mid-label');
    assert.equal(/Paths to agre(?!ement)/i.test(whyText), false, 'Paths to agreement prefix must not be cut mid-label');
    assert.equal(/Next negotiation agen(?!da)/i.test(whyText), false, 'Next negotiation agenda prefix must not be cut mid-label');
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
    passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.72 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared: deliver analytics module with SLA definitions and monthly milestones.',
      confidentialText: 'Confidential: budget fixed, governance approval secured.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    assert.ok(passBPrompt.length > 0, 'Pass B prompt must have been captured');

    // Fixed 2–4 paragraph writing requirement
    assert.ok(
      passBPrompt.includes('2\u20134 short paragraphs'),
      'Pass B prompt must specify the 2\u20134 short paragraphs per required heading writing requirement',
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
      passBPrompt.includes('Section roles are strict'),
      'Pass B prompt must define distinct section roles to reduce repetition',
    );

    assert.ok(
      passBPrompt.includes('Avoid exaggerated language'),
      'Pass B prompt must explicitly ban overstated severity language unless supported',
    );

    // Assumptions / Dependencies mandatory element
    assert.ok(
      passBPrompt.includes('Assumptions / Dependencies'),
      'Pass B prompt must require an Assumptions / Dependencies paragraph',
    );

    // Paths to agreement mandatory element
    assert.ok(
      passBPrompt.includes('Paths to agreement'),
      'Pass B prompt must require a Paths to agreement paragraph with bilateral paths',
    );

    // Conditions to proceed mandatory element
    assert.ok(
      passBPrompt.includes('Conditions to proceed'),
      'Pass B prompt must require a Conditions to proceed paragraph',
    );

    // Next negotiation agenda
    assert.ok(
      passBPrompt.includes('Next negotiation agenda'),
      'Pass B prompt must require a Next negotiation agenda paragraph',
    );

    // Likely sticking points & bridges — with if/then language
    assert.ok(
      passBPrompt.includes('Likely sticking points & bridges'),
      "Pass B prompt must require a 'Likely sticking points & bridges' paragraph",
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
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Deliver a scalable analytics platform for internal teams.',
      confidentialText: 'Internal: timeline and budget are TBD pending board approval.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    if (!outcome.ok) return;

    assert.ok(
      outcome.data.missing.length >= 6,
      `missing[] must have >= 6 items when source_coverage is thin; got ${outcome.data.missing.length}`,
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
    passBPrompt = prompt;
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(validPayload({ fit_level: 'medium', confidence_0_1: 0.68 })),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Deliver analytics platform under a fixed-price engagement model.',
      confidentialText: 'Internal: fixed-price structure preferred; budget ceiling applies.',
    });

    assert.equal(outcome.ok, true, 'Evaluation must succeed');
    assert.ok(passBPrompt.length > 0, 'Pass B prompt must have been captured');

    assert.ok(
      passBPrompt.includes('Commercial posture'),
      'Pass B prompt must instruct "Commercial posture:" paragraph when fixed-price vendor preference is detected',
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
    const outcome = await evaluateWithVertexV2({
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
      whyTextLower.includes('the parties would need to') || whyTextLower.includes('the current proposal becomes easier for both sides'),
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
