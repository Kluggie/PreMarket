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
    assert.equal(outcome.data.fit_level, 'unknown', 'fallback fit_level must be unknown');
    assert.ok(outcome.data.confidence_0_1 <= 0.65, 'fallback confidence must be clamped <= 0.65');
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
    assert.equal(outcome.data.fit_level, 'unknown', 'fallback fit_level must be unknown');
    assert.ok(outcome.data.confidence_0_1 <= 0.65, 'fallback confidence must be clamped <= 0.65');
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
    assert.equal(outcome.data.fit_level, 'unknown', 'fallback fit_level must be unknown');
    assert.ok(outcome.data.confidence_0_1 <= 0.65, 'fallback confidence must be clamped <= 0.65');
  } finally {
    cleanup();
  }
});

test('v2 detects planted confidential token leak and fails hard', async () => {
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
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.error.parse_error_kind, 'confidential_leak_detected');
    assert.equal(outcome.error.retryable, false);
    assert.equal(JSON.stringify(outcome).includes(planted), false);
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

test('2-pass clamps: vague input → coverageCount < 3 → confidence capped at 0.65 and fit_level not high', async () => {
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

    // fit_level must be downgraded from high
    assert.notEqual(outcome.data.fit_level, 'high', 'fit_level must not be high when coverage < 3');
    assert.equal(outcome.data.fit_level, 'medium', 'fit_level must be downgraded to medium');

    // confidence must be capped at 0.65
    assert.equal(outcome.data.confidence_0_1 <= 0.65, true, 'confidence_0_1 must be capped at <= 0.65');

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

    // caps_applied must be empty
    assert.equal(outcome._internal?.caps_applied.length, 0, 'No caps should have been applied for full coverage');
    assert.equal(outcome._internal?.coverage_count, 5, 'coverage_count must be 5 for full-coverage sheet');
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
        for (const heading of exp.mustContainHeadings) {
          const found = outcome.data.why.some((s) => s.toLowerCase().includes(heading.toLowerCase()));
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
    assert.equal(outcome.data.fit_level, 'unknown', 'fallback fit_level must be unknown');
  } finally {
    cleanup();
  }
});
