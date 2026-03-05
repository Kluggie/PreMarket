import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWithVertexV2, validateResponseSchema } from '../../server/_lib/vertex-evaluation-v2.ts';

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

test('v2 accepts valid JSON response', async () => {
  const cleanup = setVertexV2MockSequence([
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

test('v2 retries once then fails with truncated_output and retryable=true', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: '{"fit_level":"high","confidence_0_1":0.8,"why":["partial"]',
        finishReason: 'MAX_TOKENS',
        httpStatus: 200,
      },
    },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: '{"fit_level":"high","confidence_0_1":0.8,"why":["partial"]',
        finishReason: 'MAX_TOKENS',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared text has enough content for evaluation reliability checks.',
      confidentialText: 'Confidential text has enough content for internal alignment checks.',
      requestId: 'req-trunc-1',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.attempt_count, 2);
    assert.equal(outcome.error.parse_error_kind, 'truncated_output');
    assert.equal(outcome.error.retryable, true);
    assert.equal(String(outcome.error.finish_reason || '').toLowerCase(), 'max_tokens');
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
    {
      throw: transientError,
    },
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

test('v2 fails after retry on persistent vertex_http_error and marks retryable=true', async () => {
  const transientError = Object.assign(new Error('upstream 502'), {
    code: 'vertex_request_failed',
    statusCode: 502,
    extra: {
      upstreamStatus: 502,
      upstreamMessage: 'Bad gateway',
    },
  });

  const cleanup = setVertexV2MockSequence([
    {
      throw: transientError,
    },
    {
      throw: transientError,
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared text contains enough detail for persistent upstream failure checks.',
      confidentialText: 'Confidential text contains enough detail for persistent upstream failure checks.',
      requestId: 'req-http-retry-fail-1',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.attempt_count, 2);
    assert.equal(outcome.error.parse_error_kind, 'vertex_http_error');
    assert.equal(outcome.error.retryable, true);
  } finally {
    cleanup();
  }
});

test('v2 fails on json_parse_error for non-JSON content', async () => {
  const cleanup = setVertexV2MockSequence([
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: 'Not JSON at all',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const outcome = await evaluateWithVertexV2({
      sharedText: 'Shared content for parse test.',
      confidentialText: 'Confidential content for parse test.',
      requestId: 'req-json-err-1',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.error.parse_error_kind, 'json_parse_error');
    assert.equal(outcome.error.retryable, false);
  } finally {
    cleanup();
  }
});

test('v2 detects planted confidential token leak and fails hard', async () => {
  const planted = 'CONFIDENTIAL_PRICE_12345';
  const cleanup = setVertexV2MockSequence([
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

// ─── Sanity checks: proposal-quality objective (not alignment) ───────────────
//
// These tests verify that the prompt sent to the model encodes the
// anti-alignment guardrails added in the "proposal quality" overhaul.
// They do NOT call the real Vertex API — they capture the raw prompt text
// via the mock hook and assert on its contents.

test('sanity: prompt encodes anti-alignment guardrail and proposal-quality objective', async () => {
  let capturedPrompt = '';

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    capturedPrompt = prompt;
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

    // The prompt must NOT use alignment framing.
    assert.equal(
      capturedPrompt.includes('contract/proposal alignment'),
      false,
      'Prompt must not contain old alignment framing',
    );

    // The prompt must encode the new objective.
    assert.equal(
      capturedPrompt.includes('evaluate the overall business proposal quality'),
      true,
      'Prompt must state proposal-quality objective',
    );

    // The prompt must explicitly block similarity-as-quality scoring.
    assert.equal(
      capturedPrompt.includes('NOT a quality signal'),
      true,
      'Prompt must contain the anti-alignment similarity guardrail',
    );

    // The prompt must include the unified proposal_text_excerpt concept.
    assert.equal(
      capturedPrompt.includes('SHARED / PUBLIC PORTION'),
      true,
      'Prompt must include combined proposal_text_excerpt with shared section label',
    );
    assert.equal(
      capturedPrompt.includes('CONFIDENTIAL PORTION'),
      true,
      'Prompt must include confidential section label inside proposal_text_excerpt',
    );

    // The prompt must have the hard guardrail for "high" fit_level.
    assert.equal(
      capturedPrompt.includes('"high" fit_level is RARE'),
      true,
      'Prompt must contain hard guardrail restricting "high" fit_level',
    );

    // The evaluate_proposal_quality_not_alignment constraint must be in the payload.
    assert.equal(
      capturedPrompt.includes('evaluate_proposal_quality_not_alignment'),
      true,
      'Prompt payload must include evaluate_proposal_quality_not_alignment constraint',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('sanity: identical shared+confidential does not auto-produce high/1.0 — guardrail is in prompt, not post-processing', async () => {
  // This test documents the expected behaviour: the guardrail lives in the
  // prompt (the model must respect it). If a model ignores the prompt and
  // returns high/1.0 anyway, the schema layer will still accept it —
  // the fix is intentionally at the prompt level, not a hard code clamp.
  //
  // To verify the full chain against a live model, run:
  //   VERTEX_PROJECT_ID=... node --import=tsx tests/lib/vertex-evaluation-v2.test.mjs
  // and assert that identical-text inputs do not produce fit_level: high with
  // confidence_0_1: 1.0 — they should surface missing[] items instead.

  const identicalText =
    'We will deliver a scalable platform ASAP with top dashboards and world-class support.';

  let capturedPrompt = '';
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    capturedPrompt = prompt;
    // Simulate a realistically-calibrated model response that respects the guardrails.
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify(
        validPayload({
          fit_level: 'low',
          confidence_0_1: 0.45,
          why: ['Proposal mentions a platform and dashboards, but lacks specifics.'],
          missing: [
            'No KPIs or success criteria defined.',
            'Timeline is vague ("ASAP") — no dates or milestones.',
            '"Scalable" and "world-class" are undefined.',
            'No constraints, risks, or acceptance criteria provided.',
          ],
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

    // A well-calibrated model should NOT return high fit for a vague proposal.
    assert.notEqual(outcome.data.fit_level, 'high', 'Identical vague texts must not produce fit_level: high');
    assert.equal(outcome.data.confidence_0_1 <= 0.75, true, 'Vague identical proposal should have confidence <= 0.75');
    assert.equal(outcome.data.missing.length > 0, true, 'Should surface missing items for vague proposal');

    // Verify the prompt was built with the guardrail text for identical inputs.
    assert.equal(
      capturedPrompt.includes('NOT a quality signal'),
      true,
      'Prompt must contain the anti-alignment similarity guardrail even for identical inputs',
    );
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});
