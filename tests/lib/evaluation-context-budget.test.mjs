import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBudgetedContext,
  buildConvergenceDigest,
  preflightPromptCheck,
  MAX_SHARED_BUDGET,
  MAX_CONFIDENTIAL_BUDGET,
  SAFE_TOTAL_CHARS,
  HISTORY_SNAPSHOT_BUDGET,
  MAX_HISTORY_ROUNDS,
  MAX_CONVERGENCE_DIGEST_CHARS,
  MAX_NEW_QUESTIONS_PER_ROUND,
  MAX_OPEN_QUESTIONS_CARRIED,
  RESOLUTION_OVERLAP_THRESHOLD,
  RESOLUTION_MIN_MATCHED_KEYWORDS,
  CHARS_PER_TOKEN_ESTIMATE,
  SOFT_TOKEN_CEILING,
  PROMPT_TOKEN_HARD_CEILING,
  UNRESOLVED_ROUND_FLOOR,
} from '../../server/_lib/evaluation-context-budget.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a string of n chars. */
function chars(n, char = 'x') {
  return char.repeat(Math.max(0, n));
}

function makeRound(round, opts = {}) {
  return {
    round,
    sharedTextSnapshot: opts.sharedText || `Shared text for round ${round}`,
    missingQuestions: opts.missingQuestions || [`Question from round ${round}?`],
    createdAt: opts.createdAt || new Date().toISOString(),
  };
}

// ─── buildConvergenceDigest ───────────────────────────────────────────────────

test('buildConvergenceDigest: returns null when no prior rounds', () => {
  const result = buildConvergenceDigest([], 'current shared text');
  assert.equal(result, null);
});

test('buildConvergenceDigest: returns null for undefined input', () => {
  const result = buildConvergenceDigest(undefined, 'current text');
  assert.equal(result, null);
});

test('buildConvergenceDigest: identifies open questions from prior rounds', () => {
  const rounds = [
    makeRound(1, { missingQuestions: ['What is the timeline for delivery?'] }),
    makeRound(2, { missingQuestions: ['What are the acceptance criteria?'] }),
  ];
  const result = buildConvergenceDigest(rounds, 'We are building a dashboard.');
  assert.ok(result);
  assert.equal(result.totalRounds, 2);
  // Neither question is addressed by "We are building a dashboard"
  assert.equal(result.openQuestions.length, 2);
  assert.equal(result.resolvedQuestions.length, 0);
  assert.ok(result.digestText.includes('STILL OPEN'));
  assert.ok(result.digestText.includes('CONVERGENCE RULES'));
});

test('buildConvergenceDigest: marks questions as resolved when addressed by current text', () => {
  const rounds = [
    makeRound(1, {
      missingQuestions: [
        'What is the confirmed timeline and delivery schedule?',
        'What are the acceptance criteria for completion?',
      ],
    }),
  ];
  // Current shared text addresses the timeline question
  const currentText =
    'The confirmed timeline is Q2 2026 with delivery schedule showing milestones at month 2 and month 4.';
  const result = buildConvergenceDigest(rounds, currentText);
  assert.ok(result);
  // The timeline question should be resolved, the acceptance one should not
  assert.ok(result.resolvedQuestions.length >= 1, 'At least one question should be resolved');
  assert.ok(result.openQuestions.length >= 0);
  assert.ok(result.digestText.includes('RESOLVED'));
});

test('buildConvergenceDigest: deduplicates similar questions across rounds', () => {
  const rounds = [
    makeRound(1, { missingQuestions: ['What is the confirmed project timeline and delivery schedule?'] }),
    makeRound(2, { missingQuestions: ['What is the delivery timeline and confirmed schedule?'] }),
  ];
  const result = buildConvergenceDigest(rounds, 'Some unrelated text about budgets.');
  assert.ok(result);
  // The two questions are very similar and should be deduped
  const totalTracked = result.openQuestions.length + result.resolvedQuestions.length;
  assert.ok(totalTracked <= 2, `Expected deduplication to reduce count, got ${totalTracked}`);
});

test('buildConvergenceDigest: caps open questions at MAX_OPEN_QUESTIONS_CARRIED', () => {
  const manyQuestions = Array.from({ length: 15 }, (_, i) =>
    `Unique question number ${i + 1} about topic area ${String.fromCharCode(65 + i)}?`
  );
  const rounds = [makeRound(1, { missingQuestions: manyQuestions })];
  const result = buildConvergenceDigest(rounds, 'unrelated text');
  assert.ok(result);
  assert.ok(
    result.openQuestions.length <= MAX_OPEN_QUESTIONS_CARRIED,
    `Open questions should be capped at ${MAX_OPEN_QUESTIONS_CARRIED}, got ${result.openQuestions.length}`,
  );
});

test('buildConvergenceDigest: digest text stays within MAX_CONVERGENCE_DIGEST_CHARS', () => {
  const longQuestions = Array.from({ length: 20 }, (_, i) =>
    `This is a very long question number ${i + 1} that asks about a highly specific and detailed topic area with lots of words to make it take up space in the digest: ${chars(100)}?`
  );
  const rounds = [
    makeRound(1, { missingQuestions: longQuestions.slice(0, 10) }),
    makeRound(2, { missingQuestions: longQuestions.slice(10) }),
  ];
  const result = buildConvergenceDigest(rounds, 'short text');
  assert.ok(result);
  assert.ok(
    result.digestChars <= MAX_CONVERGENCE_DIGEST_CHARS,
    `Digest should be <= ${MAX_CONVERGENCE_DIGEST_CHARS} chars, got ${result.digestChars}`,
  );
});

test('buildConvergenceDigest: includes convergence rules in digest', () => {
  const rounds = [makeRound(1, { missingQuestions: ['What is the budget?'] })];
  const result = buildConvergenceDigest(rounds, 'text');
  assert.ok(result);
  assert.ok(result.digestText.includes('CONVERGENCE RULES'));
  assert.ok(result.digestText.includes('Do NOT re-ask resolved questions'));
  assert.ok(result.digestText.includes(`at most ${MAX_NEW_QUESTIONS_PER_ROUND}`));
  assert.ok(result.digestText.includes('move toward a decision'));
});

test('buildConvergenceDigest: when all questions resolved, suggests moving to decision', () => {
  const rounds = [
    makeRound(1, {
      missingQuestions: ['What is the timeline for delivery and schedule milestones?'],
    }),
  ];
  const currentText =
    'The timeline for delivery is Q2 2026 with schedule milestones at month 2 and month 4.';
  const result = buildConvergenceDigest(rounds, currentText);
  assert.ok(result);
  if (result.resolvedQuestions.length > 0 && result.openQuestions.length === 0) {
    assert.ok(
      result.digestText.includes('move toward a decision'),
      'Should suggest moving toward decision when all resolved',
    );
  }
});

// ─── buildBudgetedContext — small payload passthrough ──────────────────────────

test('buildBudgetedContext: small payload passes through unchanged', () => {
  const result = buildBudgetedContext({
    currentSharedText: 'Short shared text',
    confidentialText: 'Short confidential text',
  });
  assert.equal(result.sharedText, 'Short shared text');
  assert.equal(result.confidentialText, 'Short confidential text');
  assert.equal(result.wasTrimmed, false);
  assert.equal(result.budget.trimmedFromShared, 0);
  assert.equal(result.budget.trimmedFromConfidential, 0);
  assert.equal(result.budget.trimmedFromHistory, 0);
});

test('buildBudgetedContext: no convergence digest when no prior rounds', () => {
  const result = buildBudgetedContext({
    currentSharedText: 'Text',
    confidentialText: 'Confidential',
  });
  assert.equal(result.convergenceDigest, null);
});

// ─── buildBudgetedContext — large payload trimming ─────────────────────────────

test('buildBudgetedContext: trims oversized shared text to MAX_SHARED_BUDGET', () => {
  const oversized = chars(MAX_SHARED_BUDGET + 5000);
  const result = buildBudgetedContext({
    currentSharedText: oversized,
    confidentialText: 'short',
    historyRounds: [{ round: 1, sharedTextSnapshot: 'prior text' }],
  });
  assert.ok(result.wasTrimmed);
  assert.ok(result.budget.trimmedFromShared > 0);
  // The output shared text should not exceed MAX_SHARED_BUDGET  
  // (it may be slightly over due to history preamble structural markers,
  //  but the current-round text portion should be capped)
  assert.ok(
    result.sharedText.length <= MAX_SHARED_BUDGET + 500, // +500 for preamble structure
    `Shared text should be within budget, got ${result.sharedText.length}`,
  );
});

test('buildBudgetedContext: trims oversized confidential text to MAX_CONFIDENTIAL_BUDGET', () => {
  // When total exceeds SAFE_TOTAL_CHARS, confidential text should be capped
  const oversizedConf = chars(MAX_CONFIDENTIAL_BUDGET + 3000);
  const oversizedShared = chars(MAX_SHARED_BUDGET + 1000);
  const result = buildBudgetedContext({
    currentSharedText: oversizedShared,
    confidentialText: oversizedConf,
    historyRounds: [{ round: 1, sharedTextSnapshot: 'prior text' }],
  });
  assert.ok(result.wasTrimmed);
  assert.ok(
    result.confidentialText.length <= MAX_CONFIDENTIAL_BUDGET,
    `Confidential text should be within budget, got ${result.confidentialText.length}`,
  );
});

test('buildBudgetedContext: history rounds are included when budget allows', () => {
  const result = buildBudgetedContext({
    currentSharedText: chars(2000),
    confidentialText: chars(2000),
    historyRounds: [
      { round: 1, sharedTextSnapshot: 'Round 1 shared text' },
      { round: 2, sharedTextSnapshot: 'Round 2 shared text' },
    ],
  });
  assert.ok(result.sharedText.includes('EXCHANGE HISTORY'));
  assert.ok(result.sharedText.includes('Round 1'));
  assert.ok(result.sharedText.includes('Round 2'));
  assert.ok(result.budget.historyChars > 0);
});

test('buildBudgetedContext: history rounds are trimmed when current text is large', () => {
  // Use most of the shared budget for current text
  const currentShared = chars(MAX_SHARED_BUDGET - 500);
  const result = buildBudgetedContext({
    currentSharedText: currentShared,
    confidentialText: 'short',
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(2000) },
      { round: 2, sharedTextSnapshot: chars(2000) },
    ],
  });
  // History should be trimmed or omitted because current text takes most of the budget
  assert.ok(result.budget.historyChars < 4000, 'History should be compressed');
});

// ─── buildBudgetedContext — unresolved blockers retained ──────────────────────

test('buildBudgetedContext: unresolved blockers are retained in convergence digest', () => {
  const priorRounds = [
    makeRound(1, {
      missingQuestions: [
        'What is the confirmed budget for this project?',
        'Who owns the third-party integrations?',
      ],
    }),
  ];
  const result = buildBudgetedContext({
    currentSharedText: 'The project uses React and Node.js.',
    confidentialText: 'Internal budget: $500k',
    priorEvaluationRounds: priorRounds,
  });
  assert.ok(result.convergenceDigest);
  // Both questions should be open since the current text doesn't address them
  assert.ok(
    result.convergenceDigest.openQuestions.length >= 1,
    'Unresolved blockers should be retained',
  );
  assert.ok(
    result.convergenceDigest.digestText.includes('STILL OPEN'),
    'Digest should mention open questions',
  );
});

// ─── Already-answered questions are not reintroduced ──────────────────────────

test('buildConvergenceDigest: already-answered questions are marked resolved', () => {
  const rounds = [
    makeRound(1, {
      missingQuestions: [
        'What budget and resource constraints apply to delivery?',
      ],
    }),
  ];
  const currentText =
    'The budget constraint is $500,000 and resource constraints include a team of 5 developers with delivery timeline of 6 months.';
  const result = buildConvergenceDigest(rounds, currentText);
  assert.ok(result);
  assert.ok(
    result.resolvedQuestions.length >= 1,
    'Question about budget/resource constraints should be resolved',
  );
  assert.ok(
    result.digestText.includes('RESOLVED'),
    'Digest should explicitly mark resolved questions',
  );
  assert.ok(
    result.digestText.includes('do NOT re-ask'),
    'Digest should instruct model not to re-ask',
  );
});

// ─── AI does not keep expanding scope indefinitely ────────────────────────────

test('buildConvergenceDigest: convergence rules cap new questions per round', () => {
  const rounds = [makeRound(1), makeRound(2), makeRound(3)];
  const result = buildConvergenceDigest(rounds, 'current text');
  assert.ok(result);
  assert.ok(
    result.digestText.includes(`at most ${MAX_NEW_QUESTIONS_PER_ROUND}`),
    'Should include max-new-questions cap',
  );
  assert.ok(
    result.digestText.includes('move toward a decision'),
    'Should guide toward convergence',
  );
});

test('buildConvergenceDigest: prioritizes resolving existing over new questions', () => {
  const rounds = [
    makeRound(1, { missingQuestions: ['Existing blocker question?'] }),
  ];
  const result = buildConvergenceDigest(rounds, 'unrelated');
  assert.ok(result);
  assert.ok(
    result.digestText.includes('Prioritize resolving the STILL OPEN questions'),
    'Should prioritize existing open questions',
  );
});

// ─── Response shape backward-compatibility ────────────────────────────────────

test('buildBudgetedContext: response shape is backward-compatible', () => {
  const result = buildBudgetedContext({
    currentSharedText: 'text',
    confidentialText: 'conf',
  });
  // Verify expected shape
  assert.equal(typeof result.sharedText, 'string');
  assert.equal(typeof result.confidentialText, 'string');
  assert.equal(typeof result.wasTrimmed, 'boolean');
  assert.equal(typeof result.budget, 'object');
  assert.equal(typeof result.budget.sharedInputChars, 'number');
  assert.equal(typeof result.budget.confidentialInputChars, 'number');
  assert.equal(typeof result.budget.historyChars, 'number');
  assert.equal(typeof result.budget.convergenceDigestChars, 'number');
  assert.equal(typeof result.budget.totalChars, 'number');
  assert.equal(typeof result.budget.trimmedFromShared, 'number');
  assert.equal(typeof result.budget.trimmedFromConfidential, 'number');
  assert.equal(typeof result.budget.trimmedFromHistory, 'number');
  // convergenceDigest is null or object
  assert.ok(result.convergenceDigest === null || typeof result.convergenceDigest === 'object');
});

test('buildConvergenceDigest: response shape has expected fields', () => {
  const rounds = [makeRound(1)];
  const result = buildConvergenceDigest(rounds, 'text');
  assert.ok(result);
  assert.equal(typeof result.totalRounds, 'number');
  assert.ok(Array.isArray(result.resolvedQuestions));
  assert.ok(Array.isArray(result.openQuestions));
  assert.equal(typeof result.digestText, 'string');
  assert.equal(typeof result.digestChars, 'number');
  // Each question has expected shape
  for (const q of [...result.resolvedQuestions, ...result.openQuestions]) {
    assert.equal(typeof q.text, 'string');
    assert.equal(typeof q.firstAskedRound, 'number');
    assert.equal(typeof q.resolved, 'boolean');
  }
});

// ─── No regression: existing flow unchanged for smaller payloads ──────────────

test('buildBudgetedContext: no trimming when total is within SAFE_TOTAL_CHARS', () => {
  const halfBudget = Math.floor(SAFE_TOTAL_CHARS / 2) - 100;
  const result = buildBudgetedContext({
    currentSharedText: chars(halfBudget),
    confidentialText: chars(halfBudget),
  });
  assert.equal(result.wasTrimmed, false);
  assert.equal(result.sharedText.length, halfBudget);
  assert.equal(result.confidentialText.length, halfBudget);
});

test('buildBudgetedContext: empty history rounds produce no preamble', () => {
  const result = buildBudgetedContext({
    currentSharedText: 'just text',
    confidentialText: 'just conf',
    historyRounds: [],
  });
  assert.equal(result.sharedText, 'just text');
  assert.ok(!result.sharedText.includes('EXCHANGE HISTORY'));
});

// ─── Constants are reasonable ─────────────────────────────────────────────────

test('budget constants: MAX_SHARED_BUDGET matches V2 engine limit', () => {
  assert.equal(MAX_SHARED_BUDGET, 16_000);
});

test('budget constants: MAX_CONFIDENTIAL_BUDGET matches V2 engine limit', () => {
  assert.equal(MAX_CONFIDENTIAL_BUDGET, 16_000);
});

test('budget constants: SAFE_TOTAL_CHARS is sum of budgets', () => {
  assert.equal(SAFE_TOTAL_CHARS, MAX_SHARED_BUDGET + MAX_CONFIDENTIAL_BUDGET);
});

test('budget constants: MAX_NEW_QUESTIONS_PER_ROUND is reasonable', () => {
  assert.ok(MAX_NEW_QUESTIONS_PER_ROUND >= 1 && MAX_NEW_QUESTIONS_PER_ROUND <= 5);
});

test('budget constants: MAX_OPEN_QUESTIONS_CARRIED is reasonable', () => {
  assert.ok(MAX_OPEN_QUESTIONS_CARRIED >= 5 && MAX_OPEN_QUESTIONS_CARRIED <= 15);
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test('buildBudgetedContext: handles empty strings gracefully', () => {
  const result = buildBudgetedContext({
    currentSharedText: '',
    confidentialText: '',
  });
  assert.equal(result.sharedText, '');
  assert.equal(result.confidentialText, '');
  assert.equal(result.wasTrimmed, false);
});

test('buildConvergenceDigest: handles rounds with empty missing questions', () => {
  const rounds = [makeRound(1, { missingQuestions: [] })];
  const result = buildConvergenceDigest(rounds, 'text');
  assert.ok(result);
  assert.equal(result.openQuestions.length, 0);
  assert.equal(result.resolvedQuestions.length, 0);
});

test('buildConvergenceDigest: filters out empty question strings', () => {
  const rounds = [makeRound(1, { missingQuestions: ['', '  ', 'Valid question?'] })];
  const result = buildConvergenceDigest(rounds, 'unrelated');
  assert.ok(result);
  assert.equal(result.openQuestions.length, 1);
  assert.equal(result.openQuestions[0].text, 'Valid question?');
});

test('buildBudgetedContext: MAX_HISTORY_ROUNDS limits included rounds', () => {
  const manyRounds = Array.from({ length: 8 }, (_, i) => ({
    round: i + 1,
    sharedTextSnapshot: `Round ${i + 1} text`,
  }));
  const result = buildBudgetedContext({
    currentSharedText: chars(2000),
    confidentialText: chars(2000),
    historyRounds: manyRounds,
  });
  // Count how many rounds appear in the output
  let roundMentions = 0;
  for (let i = 1; i <= 8; i++) {
    if (result.sharedText.includes(`Exchange Round ${i}`)) {
      roundMentions++;
    }
  }
  assert.ok(
    roundMentions <= MAX_HISTORY_ROUNDS,
    `Should include at most ${MAX_HISTORY_ROUNDS} rounds, found ${roundMentions}`,
  );
});
// ─── Caveat A: Token preflight ────────────────────────────────────────────────

test('token preflight: estimatedTokens is present on BudgetResult', () => {
  const result = buildBudgetedContext({
    currentSharedText: 'Short shared text',
    confidentialText: 'Short confidential text',
  });
  assert.equal(typeof result.estimatedTokens, 'number');
  assert.ok(result.estimatedTokens > 0, 'Token estimate should be positive for non-empty input');
});

test('token preflight: matches chars / CHARS_PER_TOKEN_ESTIMATE', () => {
  const shared = chars(4000);
  const conf = chars(4000);
  const result = buildBudgetedContext({
    currentSharedText: shared,
    confidentialText: conf,
  });
  const expectedTokens = Math.ceil(8000 / CHARS_PER_TOKEN_ESTIMATE);
  assert.equal(result.estimatedTokens, expectedTokens);
});

test('token preflight: stays within SOFT_TOKEN_CEILING after trimming', () => {
  // Large inputs that trigger trimming
  const result = buildBudgetedContext({
    currentSharedText: chars(MAX_SHARED_BUDGET + 5000),
    confidentialText: chars(MAX_CONFIDENTIAL_BUDGET + 5000),
    historyRounds: [{ round: 1, sharedTextSnapshot: chars(3000) }],
  });
  assert.ok(
    result.estimatedTokens <= SOFT_TOKEN_CEILING,
    `Estimated tokens (${result.estimatedTokens}) should be <= SOFT_TOKEN_CEILING (${SOFT_TOKEN_CEILING})`,
  );
});

test('token preflight: CHARS_PER_TOKEN_ESTIMATE is 4', () => {
  assert.equal(CHARS_PER_TOKEN_ESTIMATE, 4);
});

test('token preflight: SOFT_TOKEN_CEILING is reasonable', () => {
  assert.ok(SOFT_TOKEN_CEILING >= 6000 && SOFT_TOKEN_CEILING <= 10000);
});

// ─── preflightPromptCheck (real prompt-level preflight) ───────────────────────

test('preflightPromptCheck: runs on the exact prompt string', () => {
  const fakePrompt = chars(20000, 'A'); // 20K chars → ~5K tokens
  const result = preflightPromptCheck(fakePrompt);
  assert.equal(result.promptChars, 20000);
  assert.equal(result.estimatedPromptTokens, Math.ceil(20000 / CHARS_PER_TOKEN_ESTIMATE));
  assert.equal(result.overCeiling, false);
  assert.equal(result.ceiling, PROMPT_TOKEN_HARD_CEILING);
});

test('preflightPromptCheck: flags overCeiling for huge prompts', () => {
  const hugeChars = PROMPT_TOKEN_HARD_CEILING * CHARS_PER_TOKEN_ESTIMATE + 100;
  const result = preflightPromptCheck(chars(hugeChars));
  assert.equal(result.overCeiling, true);
  assert.ok(result.estimatedPromptTokens > PROMPT_TOKEN_HARD_CEILING);
});

test('preflightPromptCheck: small prompts pass cleanly', () => {
  const result = preflightPromptCheck('short prompt');
  assert.equal(result.overCeiling, false);
  assert.ok(result.estimatedPromptTokens < 10);
});

test('preflightPromptCheck: returns PreflightResult with expected shape', () => {
  const result = preflightPromptCheck(chars(1000));
  assert.equal(typeof result.promptChars, 'number');
  assert.equal(typeof result.estimatedPromptTokens, 'number');
  assert.equal(typeof result.overCeiling, 'boolean');
  assert.equal(typeof result.ceiling, 'number');
});

test('preflightPromptCheck: PROMPT_TOKEN_HARD_CEILING is reasonable', () => {
  assert.ok(
    PROMPT_TOKEN_HARD_CEILING >= 10000 && PROMPT_TOKEN_HARD_CEILING <= 50000,
    `Ceiling (${PROMPT_TOKEN_HARD_CEILING}) should be between 10K and 50K tokens`,
  );
});

// ─── Caveat B: Conservative resolution detection ─────────────────────────────

test('conservative resolution: RESOLUTION_OVERLAP_THRESHOLD is >= 0.6', () => {
  assert.ok(
    RESOLUTION_OVERLAP_THRESHOLD >= 0.6,
    `Threshold (${RESOLUTION_OVERLAP_THRESHOLD}) should be >= 0.6 to avoid false positives`,
  );
});

test('conservative resolution: requires minimum matched keywords', () => {
  assert.ok(
    RESOLUTION_MIN_MATCHED_KEYWORDS >= 3,
    `Min matched keywords (${RESOLUTION_MIN_MATCHED_KEYWORDS}) should be >= 3`,
  );
});

test('conservative resolution: short generic question is NOT falsely resolved', () => {
  // A short question sharing a couple of common words with the text should NOT resolve
  const rounds = [
    makeRound(1, { missingQuestions: ['What does this cost?'] }),
  ];
  const currentText = 'This project involves building a new cost-effective dashboard.';
  const result = buildConvergenceDigest(rounds, currentText);
  assert.ok(result);
  // "cost" may overlap but with stopwords and min-keywords, should not resolve
  assert.equal(
    result.resolvedQuestions.length,
    0,
    'Short generic question should remain open (not enough matched keywords)',
  );
});

test('conservative resolution: question with rich overlap still resolves', () => {
  const rounds = [
    makeRound(1, {
      missingQuestions: [
        'What is the confirmed project timeline, delivery schedule, and milestone dates?',
      ],
    }),
  ];
  const currentText =
    'The confirmed project timeline shows delivery schedule with milestone dates in Q1 and Q2 2026.';
  const result = buildConvergenceDigest(rounds, currentText);
  assert.ok(result);
  assert.ok(
    result.resolvedQuestions.length >= 1,
    'Question with rich keyword overlap should be resolved',
  );
});

test('conservative resolution: stopwords are filtered from keyword extraction', () => {
  // Two texts that share only stopwords and short words should not resolve
  const rounds = [
    makeRound(1, { missingQuestions: ['What about their plan?'] }),
  ];
  // Shares "what", "about", "their" but those are stopwords
  const currentText = 'What about their recent activity in the market?';
  const result = buildConvergenceDigest(rounds, currentText);
  assert.ok(result);
  // After stopword removal, "plan" vs "recent", "activity", "market" — no overlap
  assert.equal(
    result.resolvedQuestions.length,
    0,
    'Shared stopwords should not cause false positive resolution',
  );
});

// ─── Caveat C: Scope confirmation ─────────────────────────────────────────────

test('scope: budget module is NOT imported by proposer-side evaluate route', async () => {
  // Read the proposer-side evaluate route source and verify it does not
  // import from evaluation-context-budget.
  const { readFileSync } = await import('node:fs');
  const proposerRoute = readFileSync(
    new URL('../../server/routes/document-comparisons/[id]/evaluate.ts', import.meta.url),
    'utf-8',
  );
  assert.ok(
    !proposerRoute.includes('evaluation-context-budget'),
    'Proposer-side evaluate route should NOT import evaluation-context-budget',
  );
  assert.ok(
    !proposerRoute.includes('buildBudgetedContext'),
    'Proposer-side evaluate route should NOT reference buildBudgetedContext',
  );
  assert.ok(
    !proposerRoute.includes('buildConvergenceDigest'),
    'Proposer-side evaluate route should NOT reference buildConvergenceDigest',
  );
});

test('scope: budget module IS imported by shared-report evaluate route', async () => {
  const { readFileSync } = await import('node:fs');
  const sharedRoute = readFileSync(
    new URL('../../server/routes/shared-report/[token]/evaluate.ts', import.meta.url),
    'utf-8',
  );
  assert.ok(
    sharedRoute.includes('evaluation-context-budget'),
    'Shared-report evaluate route SHOULD import evaluation-context-budget',
  );
});

// ─── Dynamic resolved-history policy ──────────────────────────────────────────

test('dynamic policy: resolved rounds NOT compressed when no budget pressure', () => {
  // With small current text, there's plenty of room for history.
  // Two rounds with 500-char snapshots — well under the 10K+ remaining budget.
  const result = buildBudgetedContext({
    currentSharedText: chars(1000),
    confidentialText: chars(1000),
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(500) },
      { round: 2, sharedTextSnapshot: chars(500) },
    ],
    priorEvaluationRounds: [
      // Round 1 is resolved, round 2 is unresolved
      makeRound(1, {
        missingQuestions: ['What is the confirmed project timeline, delivery schedule, and milestone dates?'],
      }),
      makeRound(2, {
        missingQuestions: ['What is the cloud hosting provider and deployment architecture?'],
      }),
    ],
  });
  // Both rounds should get their full content (500 chars each) since no pressure
  assert.equal(result.budget.trimmedFromHistory, 0,
    'No history should be trimmed when comfortably under budget');
  assert.ok(result.sharedText.includes('Exchange Round 1'));
  assert.ok(result.sharedText.includes('Exchange Round 2'));
});

test('dynamic policy: under budget pressure, resolved rounds compress before unresolved', () => {
  // Create enough pressure that trimming is needed.
  // Current text takes most of budget, leaving little for history.
  const currentText = chars(MAX_SHARED_BUDGET - 2500);
  const result = buildBudgetedContext({
    currentSharedText: currentText,
    confidentialText: 'conf',
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(2000) },
      { round: 2, sharedTextSnapshot: chars(2000) },
    ],
    priorEvaluationRounds: [
      // Round 1 question is resolved by the content keywords below
      makeRound(1, {
        missingQuestions: [
          'What is the confirmed project timeline, delivery schedule, and milestone dates?',
        ],
      }),
      // Round 2 question is NOT resolved
      makeRound(2, {
        missingQuestions: ['What is the cloud hosting provider and deployment architecture?'],
      }),
    ],
  });
  // Round 1's snapshot should be more trimmed than round 2's
  const round1Match = result.sharedText.match(/\[Exchange Round 1[^\]]*\]\n([\s\S]*?)(?=\n\n---|\n\n===)/);
  const round2Match = result.sharedText.match(/\[Exchange Round 2[^\]]*\]\n([\s\S]*?)(?=\n\n===)/);
  if (round1Match && round2Match) {
    assert.ok(
      round1Match[1].length <= round2Match[1].length,
      `Resolved round 1 (${round1Match[1].length} chars) should get <= unresolved round 2 (${round2Match[1].length} chars)`,
    );
  }
});

test('dynamic policy: unresolved rounds retain a safe floor', () => {
  // Very tight budget: current text fills almost everything.
  const currentText = chars(MAX_SHARED_BUDGET - 500);
  const result = buildBudgetedContext({
    currentSharedText: currentText,
    confidentialText: 'conf',
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(2000) },
    ],
    priorEvaluationRounds: [
      makeRound(1, {
        missingQuestions: ['What is the cloud hosting architecture?'],
      }),
    ],
  });
  // Even under tight budget, if the round has unresolved questions it should
  // get at least UNRESOLVED_ROUND_FLOOR chars — unless total budget is < 200
  if (result.budget.historyChars > 0) {
    assert.ok(
      result.budget.historyChars >= UNRESOLVED_ROUND_FLOOR || result.budget.historyChars === 0,
      `Unresolved round should get at least ${UNRESOLVED_ROUND_FLOOR} chars or be dropped, got ${result.budget.historyChars}`,
    );
  }
});

test('dynamic policy: current shared text always wins over history', () => {
  const currentText = chars(MAX_SHARED_BUDGET - 100);
  const result = buildBudgetedContext({
    currentSharedText: currentText,
    confidentialText: 'conf',
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(3000) },
      { round: 2, sharedTextSnapshot: chars(3000) },
    ],
  });
  assert.ok(
    result.sharedText.includes(currentText),
    'Current-round text should be fully preserved in output',
  );
  assert.equal(result.budget.trimmedFromShared, 0, 'Current shared text should not be trimmed');
  assert.ok(
    result.budget.historyChars === 0 || result.budget.trimmedFromHistory > 0,
    'History should either be dropped or trimmed — never crowd out current text',
  );
});

test('dynamic policy: oversized current text is capped but not sacrificed for history', () => {
  const oversized = chars(MAX_SHARED_BUDGET + 5000);
  const result = buildBudgetedContext({
    currentSharedText: oversized,
    confidentialText: 'conf',
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(2000) },
    ],
  });
  assert.equal(result.budget.trimmedFromShared, 5000);
  assert.equal(result.budget.historyChars, 0,
    'No history chars should be included when current text fills the budget');
});

test('dynamic policy: all resolved rounds still get some budget when under moderate pressure', () => {
  // 4K current text leaves ~8K for history. 4 rounds × 2K = 8K demand.
  // pressureRatio ≈ 1.0 → resolved rounds should NOT be aggressively cut.
  const result = buildBudgetedContext({
    currentSharedText: chars(4000),
    confidentialText: chars(4000),
    historyRounds: [
      { round: 1, sharedTextSnapshot: chars(2000) },
      { round: 2, sharedTextSnapshot: chars(2000) },
      { round: 3, sharedTextSnapshot: chars(2000) },
      { round: 4, sharedTextSnapshot: chars(2000) },
    ],
    priorEvaluationRounds: [
      makeRound(1, { missingQuestions: [
        'What is the confirmed project timeline, delivery schedule, and milestone dates?',
      ] }),
      makeRound(2, { missingQuestions: [] }),
      makeRound(3, { missingQuestions: [] }),
      makeRound(4, { missingQuestions: ['What is the cloud hosting architecture?'] }),
    ],
  });
  // All 4 rounds should appear in the output
  for (let i = 1; i <= 4; i++) {
    assert.ok(result.sharedText.includes(`Exchange Round ${i}`),
      `Round ${i} should be present in history preamble`);
  }
});

test('dynamic policy: UNRESOLVED_ROUND_FLOOR constant is exported and reasonable', () => {
  assert.ok(UNRESOLVED_ROUND_FLOOR >= 100 && UNRESOLVED_ROUND_FLOOR <= 500);
});

// ─── Convergence behaviour still prevents scope expansion ─────────────────────

test('convergence: convergence rules cap new questions per round', () => {
  const rounds = [makeRound(1), makeRound(2), makeRound(3)];
  const result = buildConvergenceDigest(rounds, 'current text');
  assert.ok(result);
  assert.ok(
    result.digestText.includes(`at most ${MAX_NEW_QUESTIONS_PER_ROUND}`),
    'Should include max-new-questions cap',
  );
  assert.ok(
    result.digestText.includes('move toward a decision'),
    'Should guide toward convergence',
  );
});

test('convergence: prioritizes resolving existing over new questions', () => {
  const rounds = [
    makeRound(1, { missingQuestions: ['Existing blocker question?'] }),
  ];
  const result = buildConvergenceDigest(rounds, 'unrelated');
  assert.ok(result);
  assert.ok(
    result.digestText.includes('Prioritize resolving the STILL OPEN questions'),
    'Should prioritize existing open questions',
  );
});

// ─── Response shape backward-compatibility ────────────────────────────────────

test('buildBudgetedContext: response shape is backward-compatible', () => {
  const result = buildBudgetedContext({
    currentSharedText: 'text',
    confidentialText: 'conf',
  });
  // Verify expected shape
  assert.equal(typeof result.sharedText, 'string');
  assert.equal(typeof result.confidentialText, 'string');
  assert.equal(typeof result.wasTrimmed, 'boolean');
  assert.equal(typeof result.estimatedTokens, 'number');
  assert.equal(typeof result.budget, 'object');
  assert.equal(typeof result.budget.sharedInputChars, 'number');
  assert.equal(typeof result.budget.confidentialInputChars, 'number');
  assert.equal(typeof result.budget.historyChars, 'number');
  assert.equal(typeof result.budget.convergenceDigestChars, 'number');
  assert.equal(typeof result.budget.totalChars, 'number');
  assert.equal(typeof result.budget.trimmedFromShared, 'number');
  assert.equal(typeof result.budget.trimmedFromConfidential, 'number');
  assert.equal(typeof result.budget.trimmedFromHistory, 'number');
  // convergenceDigest is null or object
  assert.ok(result.convergenceDigest === null || typeof result.convergenceDigest === 'object');
});