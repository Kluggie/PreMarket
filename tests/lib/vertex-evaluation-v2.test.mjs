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
