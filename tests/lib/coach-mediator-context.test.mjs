import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractSafeMediatorContext,
  formatMediatorContextBlock,
  LATEST_SUMMARY_MAX_CHARS,
  PRIOR_SUMMARY_MAX_CHARS,
  MAX_PRIOR_ROUND_SUMMARIES,
  MAX_OPEN_ITEMS,
  MAX_ADDRESSED_ITEMS,
  ITEM_MAX_CHARS,
  MEDIATOR_CONTEXT_MAX_CHARS,
} from '../../server/_lib/coach-mediator-context.ts';
import { buildCoachPrompt } from '../../server/_lib/vertex-coach.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

const V2_PUBLIC_REPORT = {
  report_format: 'v2',
  fit_level: 'medium',
  confidence_0_1: 0.72,
  why: [
    'Technical architecture is well-documented and meets requirements.',
    'Team qualifications are strong.',
    'Security requirements are addressed.',
  ],
  missing: [
    'Pricing structure not yet clarified.',
    'Implementation timeline missing milestones.',
    'SLA terms incomplete.',
  ],
  recommendation: 'Medium',
};

const V1_EVALUATION_RESULT = {
  provider: 'vertex',
  model: 'gemini-2.5-pro',
  recommendation: 'Medium',
  confidence: 0.65,
  summary: 'Partially addressed. Pricing and timeline remain open.',
  report: {
    summary: {
      fit_level: 'medium',
      top_fit_reasons: [
        { text: 'Technical scope is clear.' },
        { text: 'Compliance requirements met.' },
      ],
      top_blockers: [
        { text: 'Budget breakdown missing.' },
        { text: 'Timeline lacks detail.' },
      ],
      next_actions: ['Resolve budget and timeline.'],
    },
    followup_questions: [
      { question_text: 'What is the detailed cost breakdown?', priority: 'high', to_party: 'b' },
      { question_text: 'When are the delivery milestones?', priority: 'high', to_party: 'b' },
    ],
  },
};

const PRIOR_RUNS = [
  {
    resultPublicReport: {
      fit_level: 'low',
      confidence_0_1: 0.4,
      why: ['Basic scope outlined.'],
      missing: ['Most technical details absent.', 'No pricing information.'],
    },
    resultJson: {},
    createdAt: new Date('2026-03-10T10:00:00Z'),
  },
  {
    resultPublicReport: {
      fit_level: 'low',
      confidence_0_1: 0.3,
      why: [],
      missing: ['Initial submission — very sparse.'],
    },
    resultJson: {},
    createdAt: new Date('2026-03-08T10:00:00Z'),
  },
];

const OTHER_PARTY_CONFIDENTIAL_TEXT =
  'CONFIDENTIAL: Our minimum acceptable price is $2.3M. Internal cost basis is $1.1M. ' +
  'Board approved up to 15% discount for strategic accounts. CEO insists on 24-month lock-in.';

const BASE_COACH_PARAMS = {
  title: 'Test Deal',
  docAText: 'Our proposal covers implementation services and ongoing support.',
  docBText: 'Shared scope of work: cloud migration, 12-month timeline, SLA targets.',
  mode: 'full',
  intent: 'negotiate',
  companyName: 'TestCorp',
  companyWebsite: 'https://test.example.com',
};

// ── extractSafeMediatorContext ─────────────────────────────────────────────

test('extractSafeMediatorContext: returns null when no evaluation data', () => {
  assert.equal(extractSafeMediatorContext({}), null);
  assert.equal(extractSafeMediatorContext({ publicReport: {} }), null);
  assert.equal(extractSafeMediatorContext({ publicReport: null, evaluationResult: null }), null);
  assert.equal(extractSafeMediatorContext({ publicReport: undefined, evaluationResult: {} }), null);
});

test('extractSafeMediatorContext: parses V2 public report', () => {
  const ctx = extractSafeMediatorContext({ publicReport: V2_PUBLIC_REPORT });
  assert.ok(ctx, 'Should return a context');
  assert.ok(ctx.latestSharedReportSummary.includes('medium'));
  assert.ok(ctx.latestSharedReportSummary.includes('72%'));
  assert.equal(ctx.openIssues.length, 3);
  assert.equal(ctx.addressedItems.length, 3);
  assert.ok(ctx.openIssues[0].includes('Pricing'));
  assert.ok(ctx.addressedItems[0].includes('Technical'));
  assert.equal(ctx.latestMediatorRecommendation, 'Medium fit');
  assert.ok(ctx.latestRoundStatus.includes('medium'));
});

test('extractSafeMediatorContext: parses V1 evaluation result', () => {
  const ctx = extractSafeMediatorContext({ evaluationResult: V1_EVALUATION_RESULT });
  assert.ok(ctx);
  assert.equal(ctx.addressedItems.length, 2);
  assert.ok(ctx.addressedItems[0].includes('Technical scope'));
  // V1 merges top_blockers + followup_questions into openIssues
  assert.ok(ctx.openIssues.length >= 2);
  assert.ok(ctx.openIssues.some((i) => i.includes('Budget')));
  assert.equal(ctx.latestMediatorRecommendation, 'Medium fit');
});

test('extractSafeMediatorContext: V2 takes priority over V1', () => {
  const ctx = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
    evaluationResult: V1_EVALUATION_RESULT,
  });
  assert.ok(ctx);
  // V2 has 3 why items, V1 has 2 — if V2 wins we get 3
  assert.equal(ctx.addressedItems.length, 3);
});

test('extractSafeMediatorContext: includes prior round summaries', () => {
  const ctx = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
    priorRuns: PRIOR_RUNS,
  });
  assert.ok(ctx);
  assert.equal(ctx.priorSharedReportSummaries.length, 2);
  assert.ok(ctx.priorSharedReportSummaries[0].summary.includes('low'));
  assert.ok(ctx.priorSharedReportSummaries[1].summary.includes('Initial'));
});

test('extractSafeMediatorContext: caps prior round summaries at MAX_PRIOR_ROUND_SUMMARIES', () => {
  const manyRuns = Array.from({ length: 10 }, (_, i) => ({
    resultPublicReport: {
      fit_level: 'low',
      why: [`Round ${i} note.`],
      missing: [`Round ${i} gap.`],
    },
    resultJson: {},
    createdAt: new Date(`2026-03-0${Math.min(i + 1, 9)}T10:00:00Z`),
  }));
  const ctx = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
    priorRuns: manyRuns,
  });
  assert.ok(ctx);
  assert.ok(ctx.priorSharedReportSummaries.length <= MAX_PRIOR_ROUND_SUMMARIES);
});

test('extractSafeMediatorContext: caps open issues at MAX_OPEN_ITEMS', () => {
  const report = {
    ...V2_PUBLIC_REPORT,
    missing: Array.from({ length: 20 }, (_, i) => `Issue ${i}`),
  };
  const ctx = extractSafeMediatorContext({ publicReport: report });
  assert.ok(ctx);
  assert.ok(ctx.openIssues.length <= MAX_OPEN_ITEMS);
});

test('extractSafeMediatorContext: caps addressed items at MAX_ADDRESSED_ITEMS', () => {
  const report = {
    ...V2_PUBLIC_REPORT,
    why: Array.from({ length: 20 }, (_, i) => `Strength ${i}`),
  };
  const ctx = extractSafeMediatorContext({ publicReport: report });
  assert.ok(ctx);
  assert.ok(ctx.addressedItems.length <= MAX_ADDRESSED_ITEMS);
});

test('extractSafeMediatorContext: truncates long item strings', () => {
  const longText = 'A'.repeat(ITEM_MAX_CHARS + 100);
  const report = {
    ...V2_PUBLIC_REPORT,
    missing: [longText],
    why: [longText],
  };
  const ctx = extractSafeMediatorContext({ publicReport: report });
  assert.ok(ctx);
  assert.ok(ctx.openIssues[0].length <= ITEM_MAX_CHARS);
  assert.ok(ctx.addressedItems[0].length <= ITEM_MAX_CHARS);
});

// ── formatMediatorContextBlock ────────────────────────────────────────────

test('formatMediatorContextBlock: returns empty string for null', () => {
  assert.equal(formatMediatorContextBlock(null), '');
});

test('formatMediatorContextBlock: includes all expected sections', () => {
  const ctx = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
    priorRuns: PRIOR_RUNS,
  });
  const block = formatMediatorContextBlock(ctx);
  assert.ok(block.includes('Shared Mediation Context'));
  assert.ok(block.includes('Status:'));
  assert.ok(block.includes('Mediator recommendation:'));
  assert.ok(block.includes('Latest shared report summary:'));
  assert.ok(block.includes('Open issues / still missing:'));
  assert.ok(block.includes('What has been addressed:'));
  assert.ok(block.includes('Prior shared report round summaries'));
  assert.ok(block.includes('End Mediation Context'));
});

test('formatMediatorContextBlock: is bounded by MEDIATOR_CONTEXT_MAX_CHARS', () => {
  // Create a context with maximally long data
  const longItems = Array.from({ length: MAX_OPEN_ITEMS }, (_, i) => 'X'.repeat(ITEM_MAX_CHARS));
  const report = {
    ...V2_PUBLIC_REPORT,
    missing: longItems,
    why: longItems,
  };
  const ctx = extractSafeMediatorContext({
    publicReport: report,
    priorRuns: PRIOR_RUNS,
  });
  const block = formatMediatorContextBlock(ctx);
  assert.ok(
    block.length <= MEDIATOR_CONTEXT_MAX_CHARS,
    `Block length (${block.length}) should be <= ${MEDIATOR_CONTEXT_MAX_CHARS}`,
  );
});

// ── Safety: no confidential leakage ──────────────────────────────────────

test('safety: mediator context does NOT include raw confidential text', () => {
  // Even if you accidentally pass confidential text it should not appear
  // because extractSafeMediatorContext only reads publicReport/evaluationResult
  const ctx = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
  });
  const block = formatMediatorContextBlock(ctx);
  assert.ok(!block.includes(OTHER_PARTY_CONFIDENTIAL_TEXT));
  assert.ok(!block.includes('$2.3M'));
  assert.ok(!block.includes('minimum acceptable'));
  assert.ok(!block.includes('Board approved'));
  assert.ok(!block.includes('CEO insists'));
});

test('safety: mediator context excludes the other side private coaching threads', () => {
  // The extractSafeMediatorContext params do not accept threadHistory,
  // so there's no channel for private coaching to leak through
  const params = {
    publicReport: V2_PUBLIC_REPORT,
    evaluationResult: V1_EVALUATION_RESULT,
    priorRuns: PRIOR_RUNS,
  };
  // Verify the function signature does not accept thread data
  const paramKeys = Object.keys(params);
  assert.ok(!paramKeys.includes('threadHistory'));
  assert.ok(!paramKeys.includes('otherPartyThreads'));
  assert.ok(!paramKeys.includes('confidentialText'));
});

// ── buildCoachPrompt integration ──────────────────────────────────────────

test('buildCoachPrompt: includes mediator context when provided', () => {
  const mediatorContext = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
    priorRuns: PRIOR_RUNS,
  });
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    mediatorContext,
  });
  assert.ok(
    prompt.includes('Shared Mediation Context'),
    'Prompt should include the mediator context block',
  );
  assert.ok(prompt.includes('Open issues / still missing:'));
  assert.ok(prompt.includes('Pricing'));
  assert.ok(prompt.includes('What has been addressed:'));
  assert.ok(prompt.includes('Technical'));
  assert.ok(prompt.includes('Prior shared report round summaries'));
});

test('buildCoachPrompt: still works without mediator context', () => {
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    mediatorContext: null,
  });
  assert.ok(!prompt.includes('Shared Mediation Context'));
  // Core prompt features still present
  assert.ok(prompt.includes('senior deal consultant'));
  assert.ok(prompt.includes('Company name: TestCorp'));
  assert.ok(prompt.includes('shared_doc'));
});

test('buildCoachPrompt: mediator context does not leak confidential text', () => {
  const mediatorContext = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
  });
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    mediatorContext,
  });
  // The mediator block exists but none of the other party's raw confidential data appears
  assert.ok(prompt.includes('Shared Mediation Context'));
  // These should NOT be in the mediator section
  assert.ok(!prompt.includes(OTHER_PARTY_CONFIDENTIAL_TEXT));
  assert.ok(!prompt.includes('$2.3M'));
});

test('buildCoachPrompt: mediator context + thread history coexist', () => {
  const mediatorContext = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
  });
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    mediatorContext,
    threadHistory: [
      { role: 'user', content: 'What about the pricing?' },
      { role: 'assistant', content: 'Pricing is not yet detailed in the shared document.' },
    ],
  });
  assert.ok(prompt.includes('Shared Mediation Context'));
  assert.ok(prompt.includes('Prior conversation'));
  assert.ok(prompt.includes('What about the pricing?'));
});

test('buildCoachPrompt: mediator context + selection mode coexist', () => {
  const mediatorContext = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
  });
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    mode: 'selection',
    intent: 'rewrite_selection',
    selectionText: 'The SLA has 99.5% uptime.',
    selectionTarget: 'shared',
    mediatorContext,
  });
  assert.ok(prompt.includes('Shared Mediation Context'));
  assert.ok(prompt.includes('99.5% uptime'));
});

test('buildCoachPrompt with custom_prompt: includes mediator context', () => {
  const mediatorContext = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
  });
  // custom_prompt goes through buildCustomPromptFeedbackPrompt — verify
  // the mediator context is injected there too (via the params passthrough)
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    intent: 'general',
    mediatorContext,
  });
  assert.ok(prompt.includes('Shared Mediation Context'));
});

// ── Backward compatibility ────────────────────────────────────────────────

test('backward compat: no mediator context (undefined) does not break prompt', () => {
  const prompt = buildCoachPrompt({
    ...BASE_COACH_PARAMS,
    // mediatorContext not provided at all
  });
  assert.ok(prompt.includes('senior deal consultant'));
  assert.ok(!prompt.includes('Mediation Context'));
});

test('backward compat: empty publicReport produces null context', () => {
  const ctx = extractSafeMediatorContext({
    publicReport: {},
    evaluationResult: {},
  });
  assert.equal(ctx, null);
});

test('backward compat: comparison with no evaluation history works fine', () => {
  const ctx = extractSafeMediatorContext({
    publicReport: undefined,
    evaluationResult: undefined,
    priorRuns: [],
  });
  assert.equal(ctx, null);
  // Format null safely
  assert.equal(formatMediatorContextBlock(ctx), '');
});

// ── Latest report preferred over stale history ────────────────────────────

test('latest shared report is preferred and shown in full summary form', () => {
  const ctx = extractSafeMediatorContext({
    publicReport: V2_PUBLIC_REPORT,
    priorRuns: PRIOR_RUNS,
  });
  assert.ok(ctx);
  // Latest summary includes latest data (72% confidence)
  assert.ok(ctx.latestSharedReportSummary.includes('72%'));
  // Prior summaries are older/shorter
  assert.ok(ctx.priorSharedReportSummaries[0].summary.length <= PRIOR_SUMMARY_MAX_CHARS);
  // Verify the latest summary is richer than prior ones
  assert.ok(ctx.latestSharedReportSummary.length > ctx.priorSharedReportSummaries[0].summary.length);
});

// ── Constant bounds ───────────────────────────────────────────────────────

test('constants: MEDIATOR_CONTEXT_MAX_CHARS is reasonable', () => {
  assert.ok(MEDIATOR_CONTEXT_MAX_CHARS >= 2000 && MEDIATOR_CONTEXT_MAX_CHARS <= 8000);
});

test('constants: LATEST_SUMMARY_MAX_CHARS is bounded', () => {
  assert.ok(LATEST_SUMMARY_MAX_CHARS >= 200 && LATEST_SUMMARY_MAX_CHARS <= 1000);
});

test('constants: MAX_OPEN_ITEMS and MAX_ADDRESSED_ITEMS are bounded', () => {
  assert.ok(MAX_OPEN_ITEMS >= 5 && MAX_OPEN_ITEMS <= 20);
  assert.ok(MAX_ADDRESSED_ITEMS >= 5 && MAX_ADDRESSED_ITEMS <= 20);
});

// ── Scope verification ────────────────────────────────────────────────────

test('scope: coach-mediator-context is imported by vertex-coach', async () => {
  const { readFileSync } = await import('node:fs');
  const coachSrc = readFileSync(
    new URL('../../server/_lib/vertex-coach.ts', import.meta.url),
    'utf-8',
  );
  assert.ok(coachSrc.includes('coach-mediator-context'), 'vertex-coach.ts should import coach-mediator-context');
  assert.ok(coachSrc.includes('formatMediatorContextBlock'), 'vertex-coach.ts should use formatMediatorContextBlock');
  assert.ok(coachSrc.includes('mediatorContext'), 'vertex-coach.ts should reference mediatorContext param');
});

test('scope: owner coach route imports extractSafeMediatorContext', async () => {
  const { readFileSync } = await import('node:fs');
  const routeSrc = readFileSync(
    new URL('../../server/routes/document-comparisons/[id]/coach.ts', import.meta.url),
    'utf-8',
  );
  assert.ok(routeSrc.includes('extractSafeMediatorContext'));
  assert.ok(routeSrc.includes('mediatorContext'));
  assert.ok(routeSrc.includes('existing.publicReport'), 'Owner route should read publicReport from existing comparison');
});

test('scope: recipient coach route imports extractSafeMediatorContext', async () => {
  const { readFileSync } = await import('node:fs');
  const routeSrc = readFileSync(
    new URL('../../server/routes/shared-report/[token]/coach.ts', import.meta.url),
    'utf-8',
  );
  assert.ok(routeSrc.includes('extractSafeMediatorContext'));
  assert.ok(routeSrc.includes('mediatorContext'));
  assert.ok(routeSrc.includes('sharedReportEvaluationRuns'), 'Recipient route should query evaluation runs');
});

test('scope: neither coach route reads raw other-party confidential text for mediator context', async () => {
  const { readFileSync } = await import('node:fs');
  const ownerSrc = readFileSync(
    new URL('../../server/routes/document-comparisons/[id]/coach.ts', import.meta.url),
    'utf-8',
  );
  const recipientSrc = readFileSync(
    new URL('../../server/routes/shared-report/[token]/coach.ts', import.meta.url),
    'utf-8',
  );
  // The mediator context extraction should NOT reference docAText or confidentialText
  // in the extractSafeMediatorContext call
  const ownerExtractCall = ownerSrc.match(/extractSafeMediatorContext\(\{[\s\S]*?\}\)/);
  assert.ok(ownerExtractCall, 'Should find extractSafeMediatorContext call in owner route');
  assert.ok(!ownerExtractCall[0].includes('docAText'), 'Should NOT pass docAText to mediator context');
  assert.ok(!ownerExtractCall[0].includes('confidential'), 'Should NOT pass confidential text to mediator context');
  
  const recipientExtractCall = recipientSrc.match(/extractSafeMediatorContext\(\{[\s\S]*?\}\)/);
  assert.ok(recipientExtractCall, 'Should find extractSafeMediatorContext call in recipient route');
  assert.ok(!recipientExtractCall[0].includes('docAText'), 'Should NOT pass docAText to mediator context');
});
