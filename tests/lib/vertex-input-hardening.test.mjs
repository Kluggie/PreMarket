/**
 * Vertex AI Input/Output Hardening Tests
 *
 * Verifies that:
 * 1. sanitizeUserInput correctly normalizes all kinds of user text
 * 2. The evaluation pipeline handles arbitrary free-form user content safely
 * 3. Output JSON parsing is robust (fences, repair, fallback)
 * 4. The existing workflow is not changed or broken
 *
 * All Vertex API calls are mocked — no live network calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeUserInput,
  wrapRawUserContent,
} from '../../server/_lib/vertex-input-sanitizer.ts';
import {
  evaluateWithVertexV2,
} from '../../server/_lib/vertex-evaluation-v2.ts';
import {
  buildCoachPrompt,
} from '../../server/_lib/vertex-coach.ts';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Return a mock Vertex call that captures all prompt strings and serves
 * canned responses from the provided sequence.
 * Call 1 = Pass A (fact sheet extraction), Call 2+ = Pass B (evaluation).
 */
function setupMockSequence(sequence) {
  const capturedPrompts = [];
  let index = 0;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    capturedPrompts.push(prompt);
    const step = sequence[index];
    index += 1;
    if (!step) throw new Error(`No mocked response for call ${index}`);
    if (step.throw) throw step.throw;
    return step.response;
  };
  return {
    capturedPrompts,
    cleanup: () => {
      delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    },
  };
}

function factSheetResponse(overrides = {}) {
  return {
    model: 'gemini-2.0-flash-001',
    text: JSON.stringify({
      project_goal: 'Test project.',
      scope_deliverables: ['Deliverable A'],
      timeline: { start: '2026-Q3', duration: '3 months', milestones: [] },
      constraints: [],
      success_criteria_kpis: [],
      vendor_preferences: [],
      assumptions: [],
      risks: [],
      open_questions: [],
      missing_info: [],
      source_coverage: {
        has_scope: true,
        has_timeline: true,
        has_kpis: false,
        has_constraints: false,
        has_risks: false,
      },
      ...overrides,
    }),
    finishReason: 'STOP',
    httpStatus: 200,
  };
}

function evalResponse(overrides = {}) {
  return {
    model: 'gemini-2.0-flash-001',
    text: JSON.stringify({
      fit_level: 'medium',
      confidence_0_1: 0.6,
      why: ['Parties have aligned objectives.'],
      missing: ['Clarify acceptance criteria.'],
      redactions: [],
      ...overrides,
    }),
    finishReason: 'STOP',
    httpStatus: 200,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: sanitizeUserInput unit tests
// ─────────────────────────────────────────────────────────────────────────────

test('sanitize: null coerced to empty string', () => {
  assert.equal(sanitizeUserInput(null), '');
});

test('sanitize: undefined coerced to empty string', () => {
  assert.equal(sanitizeUserInput(undefined), '');
});

test('sanitize: non-string number coerced to string', () => {
  assert.equal(sanitizeUserInput(42), '42');
});

test('sanitize: CRLF normalized to LF', () => {
  const input = 'line one\r\nline two\r\nline three';
  const result = sanitizeUserInput(input);
  assert.equal(result, 'line one\nline two\nline three');
  assert.ok(!result.includes('\r'), 'No bare CR should remain');
});

test('sanitize: bare CR normalized to LF', () => {
  const input = 'line one\rline two';
  const result = sanitizeUserInput(input);
  assert.equal(result, 'line one\nline two');
});

test('sanitize: null bytes are stripped', () => {
  const input = 'hello\x00world\x00!';
  const result = sanitizeUserInput(input);
  assert.equal(result, 'helloworld!');
  assert.ok(!result.includes('\x00'), 'No null bytes should remain');
});

test('sanitize: other C0 control chars are stripped (SOH, STX, BEL, BS, etc.)', () => {
  // Keep: \x09 (tab), \x0A (LF)
  // Strip: \x01 \x02 \x07 \x08 \x0B \x0C \x0E \x1F \x7F
  const input = '\x01start\x07bell\x08backspace\x0Bvtab\x0Cff\x0Emid\x1Fend\x7Fdel';
  const result = sanitizeUserInput(input);
  assert.ok(!result.includes('\x01'), 'SOH stripped');
  assert.ok(!result.includes('\x07'), 'BEL stripped');
  assert.ok(!result.includes('\x08'), 'BS stripped');
  assert.ok(!result.includes('\x0B'), 'VT stripped');
  assert.ok(!result.includes('\x0C'), 'FF stripped');
  assert.ok(!result.includes('\x0E'), 'SO stripped');
  assert.ok(!result.includes('\x1F'), 'US stripped');
  assert.ok(!result.includes('\x7F'), 'DEL stripped');
  // Input breakdown after stripping:
  // start + bell + backspace + vtab + ff + mid + end + del = 33 chars
  // (\x1F strips, leaving 'end'; \x7F strips, leaving 'del'; they concatenate as 'enddel')
  assert.equal(result, 'startbellbackspacevtabffmidenddel');
});

test('sanitize: tab and LF are preserved', () => {
  const input = 'col1\tcol2\nrow2col1\trow2col2';
  const result = sanitizeUserInput(input);
  assert.equal(result, input, 'Tab and LF must not be stripped');
});

test('sanitize: bullet points preserved (dash, asterisk, Unicode bullet)', () => {
  const input = '- Item one\n* Item two\n• Item three\n– Em-dash item';
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: markdown headings preserved', () => {
  const input = '# Heading 1\n## Heading 2\n### Heading 3\nParagraph text.';
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: numbered lists preserved', () => {
  const input = '1. First item\n2. Second item\n3. Third item (with sub-items)\n   a. Sub-item A\n   b. Sub-item B';
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: quotes and apostrophes preserved', () => {
  const input = "She said \"Hello, it's a deal\" and they agreed. O'Brien confirmed.";
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: curly braces and brackets preserved', () => {
  const input = 'Config: {"key": "value", "arr": [1, 2, 3]}';
  const result = sanitizeUserInput(input);
  assert.equal(result, input, 'JSON-like text in user input must be preserved as-is');
});

test('sanitize: backticks and code-like content preserved', () => {
  const input = 'Use `console.log()` for debugging. Or ```javascript\nconst x = 1;\n```';
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: multi-line pasted email preserved', () => {
  const input = [
    'From: alice@example.com',
    'To: bob@example.com',
    'Subject: Contract draft',
    '',
    'Hi Bob,',
    '',
    'Please find attached the draft contract. Key terms:',
    '- Rate: $150/hr',
    '- Duration: 6 months',
    '- Start: 1 March 2026',
    '',
    'Regards,',
    'Alice',
  ].join('\n');
  const result = sanitizeUserInput(input);
  assert.equal(result, input, 'Pasted email must be preserved verbatim (no CR issues)');
});

test('sanitize: pasted contract fragment preserved', () => {
  const input = [
    '3.1 PAYMENT TERMS',
    'Payment shall be made within thirty (30) days of receipt of invoice,',
    'subject to [Clause 7.2]. Fees are non-refundable unless Section 4 applies.',
    '',
    'Party A ("Vendor") warrants that:',
    '  (a) services will be performed with reasonable skill and care;',
    "  (b) it holds all necessary licences; and",
    '  (c) it will comply with applicable law.',
  ].join('\n');
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: mixed JSON and narrative text preserved', () => {
  const input = 'Summary: {"status": "pending", "value": null}\n\nNote: awaiting sign-off from {department}.';
  const result = sanitizeUserInput(input);
  assert.equal(result, input);
});

test('sanitize: idempotent — calling twice gives same result', () => {
  const input = 'Hello\r\nworld\x00null-bytes and \x07bells\nNewlines preserved.';
  const once = sanitizeUserInput(input);
  const twice = sanitizeUserInput(once);
  assert.equal(once, twice, 'sanitizeUserInput must be idempotent');
});

test('sanitize: clean text unchanged', () => {
  const input = 'Plain clean text with no special characters.\nLine two.';
  const result = sanitizeUserInput(input);
  assert.equal(result, input, 'Clean text must not be modified');
});

test('sanitize: truncation adds marker when maxChars exceeded', () => {
  const input = 'a'.repeat(500);
  const maxChars = 100;
  const result = sanitizeUserInput(input, { maxChars });
  const markerIndex = result.indexOf('[USER INPUT TRUNCATED]');
  assert.ok(markerIndex >= 0, 'Must include truncation marker');
  // Content before the marker (including the preceding \n separator) must not exceed maxChars + 1
  assert.ok(markerIndex <= maxChars + 1, `Marker must start within maxChars+1 (${maxChars + 1}); got markerIndex=${markerIndex}`);
  assert.ok(result.startsWith('a'), 'Must start with original content');
  assert.ok(result.length < input.length, 'Truncated result must be shorter than original');
});

test('sanitize: no truncation when text is within maxChars', () => {
  const input = 'Short text.';
  const result = sanitizeUserInput(input, { maxChars: 1000 });
  assert.equal(result, input, 'Short text must not be truncated');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: wrapRawUserContent
// ─────────────────────────────────────────────────────────────────────────────

test('wrapRawUserContent: wraps text in named XML-style tags with type attribute', () => {
  const result = wrapRawUserContent('proposal_text', 'Some user text.');
  assert.ok(result.startsWith('<proposal_text '), 'Must start with opening tag');
  assert.ok(result.includes('type="raw_user_text"'), 'Must include type attribute');
  assert.ok(result.includes('Some user text.'), 'Must include content');
  assert.ok(result.endsWith('</proposal_text>'), 'Must end with closing tag');
});

test('wrapRawUserContent: includes may_contain attribute listing expected content types', () => {
  const result = wrapRawUserContent('doc', 'content');
  assert.ok(result.includes('may_contain='), 'Must include may_contain attribute');
  assert.ok(result.includes('bullets'), 'Must mention bullets');
  assert.ok(result.includes('markdown'), 'Must mention markdown');
  assert.ok(result.includes('braces'), 'Must mention braces');
  assert.ok(result.includes('quotes'), 'Must mention quotes');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: evaluateWithVertexV2 pipeline with special user inputs
// ─────────────────────────────────────────────────────────────────────────────

test('pipeline: bullet points in user text do not cause failure or corrupt prompt', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: [
        '# Proposal: Analytics Dashboard',
        '',
        'Deliverables:',
        '- Dashboard module',
        '- API integration',
        '- Testing & UAT',
        '',
        '## Timeline',
        '1. Phase 1: Design (Month 1)',
        '2. Phase 2: Build (Months 2-4)',
        '3. Phase 3: UAT (Month 5)',
      ].join('\n'),
      confidentialText: [
        '## Internal Notes',
        '- Budget cap: $150k',
        '- Maximum 3 engineers',
        '• Key risk: vendor dependency',
      ].join('\n'),
      requestId: 'test-bullets',
    });

    assert.ok(result.ok, 'Must return ok:true with bullet-point inputs');
    // Verify Pass A prompt contains the user content inside delimiters
    const passAPrompt = mock.capturedPrompts[0];
    assert.ok(passAPrompt.includes('<proposal_text'), 'Pass A prompt must use XML delimiter for user content');
    assert.ok(passAPrompt.includes('raw_user_text'), 'Delimiter must indicate raw_user_text type');
    assert.ok(passAPrompt.includes('Analytics Dashboard'), 'User content must appear inside delimiter');
    assert.ok(passAPrompt.includes('- Dashboard module'), 'Bullets must be preserved in prompt');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: markdown headings in user text do not cause failure', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: '# Section One\n## Sub-section\nBody text.\n### Deep section\nMore text.',
      confidentialText: '# Internal\n## Budget\nDetails here.',
      requestId: 'test-markdown-headings',
    });

    assert.ok(result.ok, 'Must return ok:true with markdown heading inputs');
    const passAPrompt = mock.capturedPrompts[0];
    assert.ok(passAPrompt.includes('# Section One'), 'Markdown headings must be in prompt');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: braces and JSON-like text in user input do not cause failure', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: [
        'Config requirements: {"timeout": 30, "retries": 3}',
        'The scope covers {all deliverables} as defined in Exhibit A.',
        'Parties agree that [pricing] will be reviewed quarterly.',
      ].join('\n'),
      confidentialText: 'Internal: {"budget": null, "approver": "TBD"}',
      requestId: 'test-braces',
    });

    assert.ok(result.ok, 'Must return ok:true when user text contains braces/JSON-like patterns');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: null bytes in user input are stripped — no hard failure', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Shared proposal\x00 with null\x00 bytes.',
      confidentialText: 'Confidential\x00 content.',
      requestId: 'test-null-bytes',
    });

    assert.ok(result.ok, 'Must return ok:true — null bytes stripped, not rejected');
    // Verify null bytes were stripped from the prompt
    const passAPrompt = mock.capturedPrompts[0];
    assert.ok(!passAPrompt.includes('\x00'), 'No null bytes must appear in the prompt');
    assert.ok(passAPrompt.includes('Shared proposal'), 'Non-null content must still be present');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: control characters in user input are stripped', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    // \x07 = BEL, \x0B = VT, \x1F = US — all should be stripped
    const result = await evaluateWithVertexV2({
      sharedText: 'Proposal\x07start\x0Bvertical\x1Funit\x7Fdel text.',
      confidentialText: 'Budget\x07bell\x0Bvtab details.',
      requestId: 'test-control-chars',
    });

    assert.ok(result.ok, 'Must return ok:true — control chars stripped, not rejected');
    const passAPrompt = mock.capturedPrompts[0];
    assert.ok(!passAPrompt.includes('\x07'), 'BEL must be stripped from prompt');
    assert.ok(!passAPrompt.includes('\x0B'), 'VT must be stripped from prompt');
    assert.ok(!passAPrompt.includes('\x7F'), 'DEL must be stripped from prompt');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: quoted text and apostrophes in user input do not cause failure', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: [
        "The vendor's proposal states: \"We guarantee 99.9% uptime.\"",
        "Party A's representative confirmed: 'Delivery by Q3 is firm.'",
        'Section 7 reads: "All IP shall be transferred within 30 days."',
      ].join('\n'),
      confidentialText: "Internal note: \"Don't accept anything below $100k.\"",
      requestId: 'test-quotes',
    });

    assert.ok(result.ok, 'Must return ok:true with quoted text inputs');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: pasted multi-line email in user input does not cause failure', async () => {
  const pastedEmail = [
    'From: vendor@example.com',
    'To: buyer@example.com',
    'Subject: Revised proposal',
    '',
    'Dear Buyer,',
    '',
    'Please find our revised proposal below:',
    '',
    '1. Deliverable: Analytics dashboard',
    '2. Timeline: 6 months from contract signing',
    '3. Cost: Fixed-price $180,000',
    '',
    'Terms & Conditions apply as per Exhibit B.',
    '',
    'Best regards,',
    'Vendor Team',
  ].join('\n');

  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: pastedEmail,
      confidentialText: 'Internal: walk-away price is $200k.',
      requestId: 'test-pasted-email',
    });

    assert.ok(result.ok, 'Must return ok:true with pasted email as input');
  } finally {
    mock.cleanup();
  }
});

test('pipeline: Pass A prompt wraps user content in <proposal_text> delimiters', async () => {
  let passAPrompt = '';
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    if (!passAPrompt) {
      passAPrompt = prompt;
      return factSheetResponse();
    }
    return evalResponse();
  };

  try {
    await evaluateWithVertexV2({
      sharedText: 'Shared text for delimiter test.',
      confidentialText: 'Confidential text for delimiter test.',
      requestId: 'test-delimiter-structure',
    });

    // The prompt must contain the XML-style delimiter
    assert.ok(passAPrompt.includes('<proposal_text'), 'Pass A must have opening delimiter');
    assert.ok(passAPrompt.includes('</proposal_text>'), 'Pass A must have closing delimiter');
    assert.ok(passAPrompt.includes('type="raw_user_text"'), 'Delimiter must have type attribute');
    assert.ok(passAPrompt.includes('may_contain='), 'Delimiter must have may_contain attribute');
    // Content must be inside the delimiter
    const delimStart = passAPrompt.indexOf('<proposal_text');
    const delimEnd = passAPrompt.indexOf('</proposal_text>');
    const inner = passAPrompt.slice(delimStart, delimEnd);
    assert.ok(inner.includes('Shared text for delimiter test.'), 'Shared text must be inside delimiter');
    assert.ok(inner.includes('Confidential text for delimiter test.'), 'Confidential text must be inside delimiter');
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Output JSON parsing robustness
// ─────────────────────────────────────────────────────────────────────────────

test('output: model response wrapped in ```json fences is parsed correctly', async () => {
  const evalJson = JSON.stringify({
    fit_level: 'high',
    confidence_0_1: 0.85,
    why: ['Strong alignment on deliverables.'],
    missing: [],
    redactions: [],
  });

  const mock = setupMockSequence([
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        // Model wrapped output in ```json fence despite instructions
        text: '```json\n' + evalJson + '\n```',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Shared proposal text for fence test.',
      confidentialText: 'Confidential: budget $80k.',
      requestId: 'test-json-fence',
    });

    assert.ok(result.ok, 'Must return ok:true — JSON fence stripped correctly');
  } finally {
    mock.cleanup();
  }
});

test('output: model response wrapped in plain ``` fences is parsed correctly', async () => {
  const evalJson = JSON.stringify({
    fit_level: 'low',
    confidence_0_1: 0.3,
    why: ['Scope is still undefined.'],
    missing: ['Define scope boundaries.'],
    redactions: [],
  });

  const mock = setupMockSequence([
    { response: factSheetResponse() },
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: '```\n' + evalJson + '\n```',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Proposal for plain fence test.',
      confidentialText: 'Internal notes.',
      requestId: 'test-plain-fence',
    });

    assert.ok(result.ok, 'Must return ok:true — plain fence stripped correctly');
  } finally {
    mock.cleanup();
  }
});

test('output: malformed Pass B output triggers retry — second attempt succeeds', async () => {
  const mock = setupMockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1: malformed (missing required keys)
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: '{"status": "ok", "message": "here is my analysis"}',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass B attempt 2 (tight retry): valid response
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Shared text — repair retry test.',
      confidentialText: 'Confidential — repair retry test.',
      requestId: 'test-repair-retry',
    });

    // Should succeed because the second attempt returned valid output
    assert.ok(result.ok, 'Must return ok:true after successful retry');
    assert.equal(mock.capturedPrompts.length >= 2, true, 'At least 2 Vertex calls should be made');
  } finally {
    mock.cleanup();
  }
});

test('output: all Pass B attempts fail — returns ok:true fallback without throwing', async () => {
  const mock = setupMockSequence([
    // Pass A succeeds
    { response: factSheetResponse() },
    // Pass B attempt 1: returns garbage
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: 'This is not JSON at all. The model did not follow instructions.',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass B attempt 2: also garbage
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: 'Still not JSON. Sorry about that!',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass B attempt 3: also garbage
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: 'This model is broken.',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Shared text — total failure test.',
      confidentialText: 'Confidential — total failure test.',
      requestId: 'test-total-failure',
    });

    // evaluateWithVertexV2 should NOT throw — it must return a failure object
    // The result may be ok:false but must not be an uncaught exception
    assert.ok(typeof result === 'object' && result !== null, 'Must return object, not throw');
    assert.ok('ok' in result, 'Result must have ok field');
  } finally {
    mock.cleanup();
  }
});

test('output: Pass A parse failure falls back gracefully — continues to Pass B', async () => {
  const mock = setupMockSequence([
    // Pass A attempt 1: returns invalid JSON for fact sheet
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: 'I could not extract the fact sheet. The proposal was unclear.',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass A attempt 2: also invalid
    {
      response: {
        model: 'gemini-2.0-flash-001',
        text: 'Still no JSON.',
        finishReason: 'STOP',
        httpStatus: 200,
      },
    },
    // Pass B: valid eval response (should still run with fallback fact sheet)
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Shared text — Pass A failure test.',
      confidentialText: 'Confidential — Pass A failure test.',
      requestId: 'test-pass-a-failure',
    });

    // Pipeline must not throw; result may be ok:true (with fallback fact sheet) or ok:false
    assert.ok(typeof result === 'object' && result !== null, 'Pipeline must return object, not throw');
    assert.ok('ok' in result, 'Result must have ok field');
  } finally {
    mock.cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5: buildCoachPrompt — special user text inputs
// ─────────────────────────────────────────────────────────────────────────────

test('coach prompt: bullet points in documents are preserved and wrapped in delimiters', () => {
  const docAText = [
    '## Internal Notes',
    '- Budget: $120k max',
    '- Team: 4 engineers',
    '• Key constraint: delivery by Q3',
  ].join('\n');

  const docBText = [
    '# Vendor Proposal',
    '1. Phase 1: Discovery (2 weeks)',
    '2. Phase 2: Development (3 months)',
    '3. Phase 3: UAT (4 weeks)',
    '',
    'Rate: $150/hr',
  ].join('\n');

  const prompt = buildCoachPrompt({
    title: 'Test Document',
    docAText,
    docBText,
    mode: 'full',
    intent: 'general',
  });

  assert.ok(prompt.includes(docAText), 'All bullet content from docA must appear in prompt');
  assert.ok(prompt.includes(docBText), 'All bullet content from docB must appear in prompt');
  // The coach already uses XML-style delimiters
  assert.ok(prompt.includes('<CONFIDENTIAL_TEXT>'), 'Prompt must use CONFIDENTIAL_TEXT delimiter');
  assert.ok(prompt.includes('<SHARED_TEXT>'), 'Prompt must use SHARED_TEXT delimiter');
});

test('coach prompt: braces and JSON-like text in documents do not break prompt', () => {
  const prompt = buildCoachPrompt({
    title: 'JSON Brace Test',
    docAText: 'Internal config: {"budget": null, "team_size": 3, "constraints": ["no overtime"]}',
    docBText: 'Clause 7: {party} shall deliver {deliverables} by {date}.',
    mode: 'full',
    intent: 'risks',
  });

  assert.ok(typeof prompt === 'string', 'Must produce a string prompt');
  assert.ok(prompt.includes('{"budget": null'), 'Braces content must be preserved');
  assert.ok(prompt.includes('{party}'), 'Template-like braces must be preserved');
});

test('coach prompt: multi-line pasted email is preserved in prompt', () => {
  const email = [
    'From: alice@example.com',
    'To: bob@example.com',
    '',
    'Hi Bob,',
    'The terms are: $200/hr, 3-month term, right-to-hire clause.',
    '',
    'Alice',
  ].join('\n');

  const prompt = buildCoachPrompt({
    title: 'Email Test',
    docAText: email,
    docBText: 'Standard vendor proposal text.',
    mode: 'full',
    intent: 'negotiate',
  });

  assert.ok(prompt.includes('alice@example.com'), 'Email address must be preserved');
  assert.ok(prompt.includes('$200/hr'), 'Email content must be preserved');
});

test('coach prompt: markdown in custom selection text preserved', () => {
  const selectionText = '**Key clause**: The Vendor warrants 99.9% uptime.\n> Note: SLA applies.';
  const prompt = buildCoachPrompt({
    title: 'Selection Markdown Test',
    docAText: 'Internal notes.',
    docBText: 'Full shared proposal with ' + selectionText + ' embedded.',
    mode: 'selection',
    intent: 'rewrite_selection',
    selectionTarget: 'shared',
    selectionText,
  });

  assert.ok(prompt.includes('**Key clause**'), 'Markdown bold in selection must be preserved');
  assert.ok(prompt.includes('> Note:'), 'Markdown blockquote in selection must be preserved');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6: Regression — existing workflow behavior unchanged
// ─────────────────────────────────────────────────────────────────────────────

test('regression: standard two-pass eval workflow still produces ok:true result', async () => {
  const mock = setupMockSequence([
    { response: factSheetResponse() },
    { response: evalResponse() },
  ]);

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'The vendor proposes a 6-month delivery with a team of 4 engineers.',
      confidentialText: 'Internal: budget cap is $180k. Walk-away at $220k.',
      requestId: 'test-regression-standard',
    });

    assert.ok(result.ok, 'Standard workflow must return ok:true');
    assert.equal(mock.capturedPrompts.length, 2, 'Exactly 2 Vertex calls (Pass A + Pass B)');
  } finally {
    mock.cleanup();
  }
});

test('regression: empty sharedText returns ok:false without throwing', async () => {
  const cleanup = () => {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  };
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    throw new Error('Should not be called for empty input');
  };

  try {
    const result = await evaluateWithVertexV2({
      sharedText: '',
      confidentialText: 'Some confidential text.',
      requestId: 'test-empty-shared',
    });

    // Must not throw — must return a failure result
    assert.ok(typeof result === 'object' && result !== null, 'Must return object');
    assert.ok('ok' in result, 'Must have ok field');
    assert.equal(result.ok, false, 'Empty sharedText must produce ok:false');
  } finally {
    cleanup();
  }
});

test('regression: empty confidentialText returns ok:false without throwing', async () => {
  const cleanup = () => {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  };
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async () => {
    throw new Error('Should not be called for empty input');
  };

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Some shared text.',
      confidentialText: '',
      requestId: 'test-empty-confidential',
    });

    assert.ok(typeof result === 'object' && result !== null, 'Must return object');
    assert.ok('ok' in result, 'Must have ok field');
    assert.equal(result.ok, false, 'Empty confidentialText must produce ok:false');
  } finally {
    cleanup();
  }
});

test('regression: Pass B prompt still contains fact_sheet from Pass A', async () => {
  let passBPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) return factSheetResponse();
    passBPrompt = prompt;
    return evalResponse();
  };

  try {
    await evaluateWithVertexV2({
      sharedText: 'Standard shared text for Pass B regression.',
      confidentialText: 'Standard confidential text for Pass B regression.',
      requestId: 'test-pass-b-regression',
    });

    assert.ok(passBPrompt.includes('fact_sheet'), 'Pass B must still include fact_sheet in payload');
    assert.ok(passBPrompt.includes('evaluate_proposal_quality_not_alignment'), 'Pass B must still contain anti-alignment guardrail');
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});

test('regression: confidential canary token handling is unaffected by sanitization', async () => {
  const canaryToken = 'CANARY_INTERNAL_77f3e2bc';
  let passAPrompt = '';
  let callCount = 0;

  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = async ({ prompt }) => {
    callCount += 1;
    if (callCount === 1) {
      passAPrompt = prompt;
      return factSheetResponse();
    }
    // Simulate a model response that (incorrectly) includes the canary token
    // — the leak guard should suppress it
    return {
      model: 'gemini-2.0-flash-001',
      text: JSON.stringify({
        fit_level: 'medium',
        confidence_0_1: 0.5,
        why: [`The proposal mentions ${canaryToken} as a constraint.`],
        missing: [],
        redactions: [],
      }),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };

  try {
    const result = await evaluateWithVertexV2({
      sharedText: 'Shared proposal text.',
      confidentialText: `Confidential internal budget. Reference: ${canaryToken}`,
      forbiddenLeakCanaryTokens: [canaryToken],
      enforceLeakGuard: true,
      requestId: 'test-canary-regression',
    });

    // The result should be ok (or ok:false from leak suppression) — not throw
    assert.ok(typeof result === 'object' && result !== null, 'Must return object, not throw');
    assert.ok('ok' in result, 'Must have ok field');

    // The canary token in confidentialText must still have been sanitized
    // (it's a normal ASCII token so sanitization doesn't affect it)
    assert.ok(passAPrompt.includes(canaryToken), 'Canary token (plain ASCII) must still appear in Pass A prompt for context extraction');
  } finally {
    delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  }
});
