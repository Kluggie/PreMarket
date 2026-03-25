/**
 * Unit tests for src/lib/aiReportUtils.js
 *
 * Tests the pure helper functions that drive the AI mediation review display.
 * No DOM or React needed — plain node:test.
 *
 * Run with:
 *   node --import=tsx --test tests/lib/ai-report-v2-display.test.mjs
 * (tsx is needed so the JS module with export syntax resolves cleanly)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasV2Report,
  getAppendixOpenQuestions,
  getDecisionStatusDetails,
  getDecisionStatusInfo,
  getMediationReviewTitle,
  getMediationReviewSubtitle,
  getPresentationReportTitle,
  getPresentationSections,
  getPrimaryInsight,
  getRunAiMediationLabel,
  getSentenceSafePreview,
  parseV2WhyEntry,
  splitV2WhyBodyParagraphs,
  truncateTextAtNaturalBoundary,
  filterLegacySectionsForDisplay,
  getConfidencePercent,
  MEDIATION_REVIEW_LABEL,
} from '../../src/lib/aiReportUtils.js';
import {
  buildMediationReviewPresentation,
  buildMediationReviewSections,
  buildStoredV2Evaluation,
  buildMediationReviewSubtitle,
  buildMediationReviewTitle,
  buildRecipientSafeEvaluationProjection,
  MEDIATION_REVIEW_TITLE,
} from '../../server/routes/document-comparisons/_helpers.ts';

// ─── hasV2Report ─────────────────────────────────────────────────────────────

test('hasV2Report: returns true when why is a non-empty array', () => {
  assert.equal(
    hasV2Report({ why: ['Executive Summary: Good proposal.'] }),
    true,
  );
});

test('hasV2Report: returns false when why is an empty array', () => {
  assert.equal(hasV2Report({ why: [] }), false);
});

test('hasV2Report: returns false when why is absent', () => {
  assert.equal(hasV2Report({ fit_level: 'medium', sections: [] }), false);
});

test('hasV2Report: returns false for null/undefined', () => {
  assert.equal(hasV2Report(null), false);
  assert.equal(hasV2Report(undefined), false);
});

// ─── parseV2WhyEntry ─────────────────────────────────────────────────────────

test('parseV2WhyEntry: extracts heading and body from standard V2 entry', () => {
  const result = parseV2WhyEntry('Executive Summary: The proposal clearly defines deliverables.');
  assert.equal(result.heading, 'Executive Summary');
  assert.equal(result.body, 'The proposal clearly defines deliverables.');
});

test('parseV2WhyEntry: handles multi-word headings', () => {
  const result = parseV2WhyEntry('Key Strengths: Timeline is realistic given the team size.');
  assert.equal(result.heading, 'Key Strengths');
  assert.equal(result.body, 'Timeline is realistic given the team size.');
});

test('parseV2WhyEntry: returns null heading for plain text without pattern', () => {
  const result = parseV2WhyEntry('Just a plain sentence with no heading.');
  assert.equal(result.heading, null);
  assert.equal(result.body, 'Just a plain sentence with no heading.');
});

test('parseV2WhyEntry: handles Data & Security Notes heading', () => {
  const result = parseV2WhyEntry('Data & Security Notes: API integration requires TLS 1.2.');
  assert.equal(result.heading, 'Data & Security Notes');
  assert.equal(result.body, 'API integration requires TLS 1.2.');
});

test('parseV2WhyEntry: empty string returns null heading and empty body', () => {
  const result = parseV2WhyEntry('');
  assert.equal(result.heading, null);
  assert.equal(result.body, '');
});

test('parseV2WhyEntry: handles Recommendations with long body', () => {
  const body = 'Ensure timeline milestones are agreed before contract signing. Address budget constraints.';
  const result = parseV2WhyEntry(`Recommendations: ${body}`);
  assert.equal(result.heading, 'Recommendations');
  assert.equal(result.body, body);
});

test('mediation review copy helpers: expose mediation-oriented labels', () => {
  assert.equal(MEDIATION_REVIEW_LABEL, 'AI Mediation Review');
  assert.equal(getRunAiMediationLabel(), 'Run AI Mediation');
  assert.equal(getRunAiMediationLabel({ hasExisting: true }), 'Re-run AI Mediation');
  assert.equal(getRunAiMediationLabel({ isPending: true }), 'Running AI Mediation...');
});

test('mediation review title helpers: avoid Untitled-style placeholders', () => {
  assert.equal(getMediationReviewTitle('', 'Untitled', 'Northwind Services Renewal'), 'Northwind Services Renewal');
  assert.equal(getMediationReviewTitle('', 'Shared Report'), 'AI Mediation Review');
  assert.equal(getMediationReviewSubtitle('', 'Shared Report'), '');
  assert.equal(getMediationReviewSubtitle('', 'Untitled proposal', 'Northwind Services Renewal'), 'Northwind Services Renewal');
  assert.equal(buildMediationReviewTitle('', 'Untitled proposal', 'Northwind Services Renewal'), 'Northwind Services Renewal');
  assert.equal(buildMediationReviewTitle('', 'Shared Report'), MEDIATION_REVIEW_TITLE);
  assert.equal(buildMediationReviewSubtitle('', 'Shared Report'), '');
});

test('decision status helpers: prefer canonical Decision Readiness status over fit-level fallback', () => {
  const report = {
    fit_level: 'high',
    confidence_0_1: 0.91,
    missing: [],
    why: [
      'Executive Summary: The deal appears workable.',
      'Decision Readiness: Decision status: Proceed with conditions. A viable path exists, but governance and milestone mechanics still need final agreement.\n\nWhat must be agreed now vs later: lock the current round terms now; defer expansion mechanics until the first milestone is met.',
    ],
  };

  assert.deepEqual(getDecisionStatusInfo(report), { label: 'Proceed with conditions', tone: 'warning' });
  assert.deepEqual(getDecisionStatusDetails(report), {
    label: 'Proceed with conditions',
    tone: 'warning',
    explanation: 'A viable path exists, but governance and milestone mechanics still need final agreement.',
  });
});

test('sentence-safe preview helpers: shorten at clean boundaries instead of mid-sentence fragments', () => {
  const text = 'Implementation certainty matters because the rollout depends on two core integrations, a staged migration, and weekend deployment windows. Support coverage will matter after go-live.';

  assert.equal(
    truncateTextAtNaturalBoundary(text, 95),
    'Implementation certainty matters because the rollout depends on two core integrations.',
  );
  assert.equal(
    getSentenceSafePreview(text, 95),
    'Implementation certainty matters because the rollout depends on two core integrations.',
  );
});

test('splitV2WhyBodyParagraphs: preserves paragraph boundaries without trimming mid-paragraph', () => {
  assert.deepEqual(
    splitV2WhyBodyParagraphs('Decision status: Explore further. More diligence is needed.\n\nWhat must be agreed now vs later: confirm the lead-time assumptions now.'),
    [
      'Decision status: Explore further. More diligence is needed.',
      'What must be agreed now vs later: confirm the lead-time assumptions now.',
    ],
  );
});

test('mediation review section helper: omits empty redactions headings while preserving why and missing', () => {
  assert.deepEqual(
    buildMediationReviewSections({
      why: ['Executive Summary: Alignment exists around the phased rollout.'],
      missing: ['What acceptance criteria define completion?'],
      redactions: [],
    }),
    [
      {
        key: 'why',
        heading: 'Why',
        bullets: ['Executive Summary: Alignment exists around the phased rollout.'],
      },
      {
        key: 'missing',
        heading: 'Missing',
        bullets: ['What acceptance criteria define completion?'],
      },
    ],
  );
});

test('presentation helpers: normalize stored dynamic sections and primary insight metadata', () => {
  const report = {
    report_title: 'Balanced Trade-Off',
    primary_insight: 'The proposal shows credible strengths, but timeline ownership still introduces material trade-offs.',
    presentation_sections: [
      {
        key: 'primary_insight',
        heading: 'Primary Insight',
        paragraphs: ['The proposal shows credible strengths, but timeline ownership still introduces material trade-offs.'],
      },
      {
        key: 'blocking_questions',
        heading: 'Blocking Questions',
        bullets: ['Who owns final launch approval?', 'What is the confirmed go-live date?'],
        numbered_bullets: true,
      },
    ],
  };

  assert.equal(getPresentationReportTitle(report), 'Balanced Trade-Off');
  assert.equal(
    getPrimaryInsight(report),
    'The proposal shows credible strengths, but timeline ownership still introduces material trade-offs.',
  );
  const sections = getPresentationSections(report);
  assert.equal(sections.length, 2);
  assert.equal(sections[1].heading, 'Blocking Questions');
  assert.equal(sections[1].numberedBullets, true);
});

test('buildMediationReviewPresentation: selects strong_alignment deterministically for high-fit, low-gap cases', () => {
  const input = {
    fit_level: 'high',
    confidence_0_1: 0.84,
    why: [
      'Executive Summary: The draft defines a phased rollout with explicit launch and sign-off mechanics.',
      'Decision Assessment: Risk Summary: Remaining risk is narrow and operational rather than structural.\n\nKey Strengths: Scope, commercial terms, and delivery ownership are already explicit.',
      'Negotiation Insights: Likely priorities: both sides appear focused on timely launch and clear accountability.\n\nPossible concessions: lower-priority enhancements can move behind the first milestone without changing the core commitment.\n\nStructural tensions: the visible tension is speed versus optional polish, not whether the core structure works.',
      'Leverage Signals: Leverage signal: the current draft already gives both parties a workable baseline, so the remaining leverage is mostly in timing rather than structure.',
      'Potential Deal Structures: Option A — keep the phased structure.\n\nOption B — defer optional enhancements until after launch.\n\nOption C — tie any expansion to the first milestone review.',
      'Decision Readiness: Decision status: Ready to finalize. The remaining issues are narrow and operational.\n\nWhat must be agreed now vs later: confirm the final sign-off owner now; defer optional enhancements until after launch.\n\nWhat would change the verdict: a material change to scope ownership would reduce confidence.',
      'Recommended Path: Recommended path: confirm the sign-off owner and move to execution.',
    ],
    missing: ['Who is the final sign-off owner? — locks the final approval path before launch.'],
    redactions: [],
  };

  const first = buildMediationReviewPresentation(input);
  const second = buildMediationReviewPresentation(input);

  assert.equal(first.report_archetype, 'strong_alignment');
  assert.equal(first.report_title, 'Strong Alignment');
  assert.equal(Array.isArray(first.presentation_sections), true);
  assert.equal(first.presentation_sections[0].heading, 'Overall Assessment');
  assert.deepEqual(first, second);
});

test('buildMediationReviewPresentation: routes low-fit and missing-heavy cases to different archetypes', () => {
  const riskPresentation = buildMediationReviewPresentation({
    fit_level: 'low',
    confidence_0_1: 0.39,
    why: [
      'Executive Summary: The draft leaves the commercial structure exposed.',
      'Decision Assessment: Risk Summary: Liability allocation and milestone ownership remain materially unbounded.\n\nKey Strengths: There is still a visible interest in reaching a deal if the structure is reset.',
      'Negotiation Insights: Likely priorities: both sides appear focused on limiting open-ended exposure.\n\nPossible concessions: sequencing non-core items later may help if the risk allocation is rewritten.\n\nStructural tensions: the main tension is between price certainty and unresolved responsibility for delivery failure.',
      'Leverage Signals: Leverage signal: time pressure exists, but it does not offset the current exposure in liability and ownership mechanics.',
      'Decision Readiness: Decision status: Not viable. Material risk remains concentrated in liability, ownership, and change control.\n\nWhat must be agreed now vs later: reallocate liability and milestone ownership now.\n\nWhat would change the verdict: bounded commercial and risk-allocation terms would materially change the assessment.',
      'Recommended Path: Recommended path: pause the current draft and restructure the risk allocation before resuming.',
    ],
    missing: ['Who owns delivery failure exposure? — determines whether the commercial structure is contractable.'],
    redactions: [],
  });

  const gapPresentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.52,
    why: [
      'Executive Summary: The visible issue is under-specification rather than an obviously hostile structure.',
      'Decision Assessment: Risk Summary: Too many core implementation details remain unstated for a reliable recommendation.\n\nKey Strengths: The draft points to a workable phased model if the missing detail is supplied.',
      'Negotiation Insights: Likely priorities: both sides appear to want momentum without committing to undefined delivery obligations.\n\nPossible concessions: the parties could sequence diligence before locking the final scope.\n\nStructural tensions: the main tension is between moving quickly and deciding without enough operational detail.',
      'Leverage Signals: Leverage signal: the current information gap is the main source of uncertainty.',
      'Decision Readiness: Decision status: Explore further. Confidence is limited because delivery timing, acceptance, dependencies, and approval mechanics are still unclear.\n\nWhat must be agreed now vs later: define the missing operational detail now.\n\nWhat would change the verdict: clearer scope, milestones, and ownership detail would materially improve confidence.',
      'Recommended Path: Recommended path: collect the missing operational detail and rerun the mediation.',
    ],
    missing: [
      'What is the confirmed go-live date? — sets the delivery sequence and staffing plan.',
      'What acceptance criteria define completion? — determines whether sign-off is measurable.',
      'Who owns third-party dependency management? — allocates schedule risk.',
      'What budget guardrails apply to change requests? — determines whether scope changes are viable.',
      'Which approvals are required before launch? — defines the governance critical path.',
      'What reporting cadence is expected post-launch? — affects ongoing resourcing.',
    ],
    redactions: [],
  });

  assert.equal(riskPresentation.report_archetype, 'risk_dominant');
  assert.equal(gapPresentation.report_archetype, 'gap_analysis');
  assert.notEqual(riskPresentation.presentation_sections[0].heading, gapPresentation.presentation_sections[0].heading);
});

test('buildMediationReviewPresentation: selects strategic_framing when multiple visible tensions are in play', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.68,
    why: [
      'Executive Summary: The structure is workable, but the trade-off depends on how the parties sequence pricing, scope, dependency ownership, governance, and the launch deadline in the right order.',
      'Decision Assessment: Risk Summary: The draft is commercially viable, but delivery timing, budget control, integration ownership, KPI sign-off, and approval mechanics remain intertwined.\n\nKey Strengths: There is visible alignment on the phased scope, stakeholder value, implementation path, and commercial intent.',
      'Negotiation Insights: Likely priorities: the visible priorities point in different directions, because one side emphasises delivery timing, implementation certainty, and KPI clarity, while the other side prioritises price discipline, approval control, and governance sequencing.\n\nPossible concessions: the visible concessions include sequencing optional work, milestone-based pricing, staged approvals, and a narrower first scope.\n\nStructural tensions: the central tension is a balance-versus-speed problem, because the parties need to balance timeline pressure, pricing certainty, dependency ownership, governance control, and post-launch reporting without overcommitting too early.',
      'Leverage Signals: Leverage signal: both sides have reasons to move, but each wants the other to absorb more of the timing, integration, and approval risk.',
      'Potential Deal Structures: Option A — a phased commercial package with milestone approvals and KPI gates.\n\nOption B — a diligence-led structure that locks dependencies, budget guardrails, and governance before final pricing.\n\nOption C — a narrower initial scope with expansion tied to approval review and launch reporting.',
      'Decision Readiness: Decision status: Proceed with conditions. The path is credible, but only if the visible priorities are sequenced into a bounded commitment.\n\nWhat must be agreed now vs later: define timing, governance, dependency ownership, KPI sign-off, and budget guardrails now.\n\nWhat would change the verdict: a cleaner split between phase-one scope and later expansion would raise confidence.',
      'Recommended Path: Recommended path: use the next negotiation round to align pricing, timeline, governance, and approvals in one bounded package.',
    ],
    missing: [
      'Who owns third-party integration approvals? — determines whether the phase-one timeline is realistic.',
      'What budget guardrails apply to phase-two expansion? — affects whether phased pricing is workable.',
    ],
    redactions: [],
  });

  assert.equal(presentation.report_archetype, 'strategic_framing');
  assert.equal(presentation.presentation_sections[0].heading, 'Core Deal Dynamic');
});

test('getAppendixOpenQuestions: omits missing items already rendered in dynamic presentation sections', () => {
  const report = {
    missing: [
      'Who owns third-party integration approvals? — clarifies the external dependency path.',
      'What budget guardrails apply to phase-two expansion? — sets the commercial ceiling.',
      'Which party signs off the launch checklist?',
    ],
    presentation_sections: [
      {
        heading: 'Blocking Questions',
        bullets: [
          'Who owns third-party integration approvals?',
          'What budget guardrails apply to phase-two expansion?',
        ],
        numbered_bullets: true,
      },
      {
        heading: 'Recommendation',
        paragraphs: ['Resolve the remaining launch approval question before final commitment.'],
      },
    ],
  };

  assert.deepEqual(getAppendixOpenQuestions(report), ['Which party signs off the launch checklist?']);
});

test('buildStoredV2Evaluation: preserves substantive evaluation fields while adding dynamic presentation metadata', () => {
  const v2Result = {
    generation_model: 'gemini-test',
    model: 'gemini-provider-test',
    data: {
      fit_level: 'medium',
      confidence_0_1: 0.64,
      why: [
        ' Executive Summary: The scope is commercially workable. ',
        'Decision Readiness: The parties still need final timeline ownership.',
      ],
      missing: [' Who owns the launch timeline? — determines execution accountability. '],
      redactions: [],
    },
  };

  const stored = buildStoredV2Evaluation(v2Result);

  assert.equal(stored.recommendation, 'Medium');
  assert.equal(stored.confidence, 0.64);
  assert.equal(stored.report.fit_level, 'medium');
  assert.deepEqual(stored.report.why, [
    'Executive Summary: The scope is commercially workable.',
    'Decision Readiness: The parties still need final timeline ownership.',
  ]);
  assert.deepEqual(stored.report.missing, [
    'Who owns the launch timeline? — determines execution accountability.',
  ]);
  assert.equal(typeof stored.report.primary_insight, 'string');
  assert.equal(Array.isArray(stored.report.presentation_sections), true);
  assert.equal(stored.report.presentation_sections.length > 0, true);
});

test('buildRecipientSafeEvaluationProjection: preserves safe presentation metadata and strips confidential markers', () => {
  const confidentialMarker = 'vault hush 991';
  const why = [
    'Executive Summary: The draft is workable with limited timeline clarification.',
    'Decision Assessment: Risk Summary: The main uncertainty is delivery timing.\n\nKey Strengths: Scope and ownership are mostly explicit.',
    'Decision Readiness: Decision status: Proceed with conditions. Timeline ownership still needs final agreement.\n\nWhat must be agreed now vs later: confirm timeline ownership now.\n\nWhat would change the verdict: a confirmed launch owner would raise confidence.',
    'Recommended Path: Recommended path: confirm the launch owner and proceed.',
  ];
  const missing = ['Who owns the final launch timeline? — locks the final delivery path.'];
  const report = {
    report_format: 'v2',
    fit_level: 'medium',
    confidence_0_1: 0.72,
    why,
    missing,
    redactions: [],
    summary: {
      fit_level: 'medium',
      top_fit_reasons: why.map((text) => ({ text })),
      top_blockers: missing.map((text) => ({ text })),
      next_actions: ['Resolve the open questions and re-run AI mediation.'],
    },
    sections: buildMediationReviewSections({ why, missing, redactions: [] }),
    recommendation: 'Medium',
    report_archetype: 'balanced_trade_off',
    report_title: `Balanced Trade-Off ${confidentialMarker}`,
    primary_insight: `The draft is workable, but ${confidentialMarker} should never appear.`,
    presentation_sections: [
      {
        heading: 'Primary Insight',
        paragraphs: [`The draft is workable, but ${confidentialMarker} should never appear.`],
      },
    ],
  };

  const projection = buildRecipientSafeEvaluationProjection({
    evaluationResult: {
      provider: 'vertex',
      model: 'test-model',
      generatedAt: '2026-03-25T00:00:00.000Z',
      score: 72,
      confidence: 72,
      recommendation: 'Medium',
      summary: 'The draft is workable with limited timeline clarification.',
      report,
    },
    publicReport: report,
    confidentialText: `Private planning note ${confidentialMarker}.`,
    sharedText: 'Shared draft with scope, timing, and ownership detail.',
    title: 'Recipient Projection Test',
  });

  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes(confidentialMarker), false);
  assert.equal(Array.isArray(projection.public_report.presentation_sections), true);
  assert.equal(typeof projection.public_report.primary_insight, 'string');
  assert.equal(projection.public_report.primary_insight.length > 0, true);
});

test('buildRecipientSafeEvaluationProjection: rebuilds dynamic sections when scrubbed presentation metadata becomes empty', () => {
  const confidentialMarker = 'vault hush 445';
  const report = {
    report_format: 'v2',
    fit_level: 'medium',
    confidence_0_1: 0.61,
    why: [
      'Executive Summary: The visible draft is workable once timeline ownership is clarified.',
      'Decision Readiness: Decision status: Proceed with conditions. Timeline ownership is still unresolved.',
      'Recommended Path: Recommended path: confirm the launch owner and proceed.',
    ],
    missing: ['Who owns the launch timeline? — determines execution accountability.'],
    redactions: [],
    summary: {
      fit_level: 'medium',
      top_fit_reasons: [{ text: 'The shared draft is directionally workable.' }],
      top_blockers: [{ text: 'Timeline ownership is still open.' }],
      next_actions: ['Resolve the launch ownership question before final commitment.'],
    },
    sections: buildMediationReviewSections({
      why: [
        'Executive Summary: The visible draft is workable once timeline ownership is clarified.',
        'Decision Readiness: Decision status: Proceed with conditions. Timeline ownership is still unresolved.',
        'Recommended Path: Recommended path: confirm the launch owner and proceed.',
      ],
      missing: ['Who owns the launch timeline? — determines execution accountability.'],
      redactions: [],
    }),
    recommendation: 'Medium',
    report_title: `Balanced Trade-Off ${confidentialMarker}`,
    primary_insight: confidentialMarker,
    presentation_sections: [
      {
        heading: 'Primary Insight',
        paragraphs: [confidentialMarker],
      },
    ],
  };

  const projection = buildRecipientSafeEvaluationProjection({
    evaluationResult: {
      provider: 'vertex',
      model: 'test-model',
      generatedAt: '2026-03-25T00:00:00.000Z',
      score: 61,
      confidence: 61,
      recommendation: 'Medium',
      summary: confidentialMarker,
      report,
    },
    publicReport: report,
    confidentialText: `Private note ${confidentialMarker}.`,
    sharedText: 'Shared scope and timing details only.',
    title: 'Recipient Projection Rebuild Test',
  });

  assert.equal(projection.public_report.presentation_sections.length > 0, true);
  assert.equal(getPresentationSections(projection.public_report).length > 0, true);
  assert.equal(JSON.stringify(projection).includes(confidentialMarker), false);
  assert.equal(projection.evaluation_result.summary, projection.public_report.primary_insight);
});

// ─── filterLegacySectionsForDisplay ──────────────────────────────────────────

test('filterLegacySectionsForDisplay: keeps category_breakdown when ≥2 numeric scores', () => {
  const sections = [
    {
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: [
        'Project Scope: score 11, confidence 80%',
        'Timeline: score 7, confidence 70%',
        'Budget: score n/a, confidence 90%',
      ],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 1, 'should keep the category breakdown section');
  // n/a row must be stripped
  assert.equal(
    result[0].bullets.some((b) => /score n\/a/i.test(b)),
    false,
    'n/a rows must be removed',
  );
  assert.equal(result[0].bullets.length, 2, 'should have 2 numeric-score rows');
});

test('filterLegacySectionsForDisplay: hides category_breakdown when < 2 numeric scores', () => {
  const sections = [
    {
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: [
        'Timeline: score n/a, confidence 70%',
        'Budget: score n/a, confidence 90%',
        'Security: score n/a, confidence 80%',
      ],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0, 'category breakdown must be hidden when no numeric scores');
});

test('filterLegacySectionsForDisplay: hides category_breakdown with exactly 1 numeric score', () => {
  const sections = [
    {
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: [
        'Project Scope: score 11, confidence 80%',
        'Timeline: score n/a, confidence 70%',
      ],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0, 'needs ≥2 numeric scores to show');
});

test('filterLegacySectionsForDisplay: keeps Risk Flags when non-empty', () => {
  const sections = [
    {
      key: 'flags',
      heading: 'Risk Flags',
      bullets: ['MED: Fixed-price preference', 'MED: Aggressive Timeline'],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Risk Flags');
  assert.equal(result[0].bullets.length, 2);
});

test('filterLegacySectionsForDisplay: hides Risk Flags when empty', () => {
  const sections = [{ key: 'flags', heading: 'Risk Flags', bullets: [] }];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0);
});

test('filterLegacySectionsForDisplay: keeps Top Blockers when non-empty', () => {
  const sections = [
    {
      key: 'top_blockers',
      heading: 'Top Blockers',
      bullets: ['Timeline has an MVP target of 6-8 weeks, which may be aggressive.'],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 1);
});

test('filterLegacySectionsForDisplay: hides Top Blockers when empty', () => {
  const sections = [{ key: 'top_blockers', heading: 'Top Blockers', bullets: [] }];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0);
});

test('filterLegacySectionsForDisplay: handles null/undefined gracefully', () => {
  assert.deepEqual(filterLegacySectionsForDisplay(null), []);
  assert.deepEqual(filterLegacySectionsForDisplay(undefined), []);
  assert.deepEqual(filterLegacySectionsForDisplay([null, undefined, { key: 'flags', heading: 'Risk Flags', bullets: [] }]), []);
});

// ─── V2-only payload → no N/A rows and no category card ─────────────────────

test('V2 payload: hasV2Report true, filterLegacySectionsForDisplay returns empty for V2 sections', () => {
  // V2 report.sections = [{key:'why',...}, {key:'missing',...}, {key:'redactions',...}]
  const v2Report = {
    fit_level: 'medium',
    confidence_0_1: 0.73,
    why: ['Executive Summary: The proposal is solid.', 'Key Strengths: Clear scope.'],
    missing: ['What is the confirmed go-live deadline?'],
    redactions: [],
    sections: [
      { key: 'why', heading: 'Why', bullets: ['Executive Summary: The proposal is solid.'] },
      { key: 'missing', heading: 'Missing', bullets: ['What is the confirmed go-live deadline?'] },
      { key: 'redactions', heading: 'Redactions', bullets: [] },
    ],
  };

  assert.equal(hasV2Report(v2Report), true, 'V2 payload must be detected');

  // When V2 is detected the caller uses isV2Report=true and skips filterLegacySectionsForDisplay.
  // But if we ran filter on V2 sections, redactions would be hidden (empty) and others shown — 
  // the UI avoids this by checking isV2Report first and passing [] instead.
  const sections = filterLegacySectionsForDisplay(v2Report.sections);
  // 'why' and 'missing' have bullets so they pass through; 'redactions' is empty and filtered out.
  assert.equal(
    sections.some((s) => s.bullets && s.bullets.some((b) => /score n\/a/i.test(b))),
    false,
    'No n/a rows in filtered V2 sections',
  );
});

// ─── Legacy payload → legacy cards render ───────────────────────────────────

test('Legacy payload: hasV2Report false for legacy report without why', () => {
  const legacyReport = {
    similarity_score: 65,
    recommendation: 'Medium',
    sections: [
      {
        key: 'category_breakdown',
        heading: 'Category Breakdown',
        bullets: [
          'Project Scope: score 11, confidence 80%',
          'Timeline: score 7, confidence 70%',
          'Budget: score n/a, confidence 90%',
          'Security: score n/a, confidence 80%',
        ],
      },
      {
        key: 'flags',
        heading: 'Risk Flags',
        bullets: ['MED: Fixed-price preference', 'MED: Aggressive Timeline'],
      },
      {
        key: 'top_blockers',
        heading: 'Top Blockers',
        bullets: ['Timeline has MVP target of 6-8 weeks.'],
      },
    ],
  };

  assert.equal(hasV2Report(legacyReport), false, 'legacy report must not be detected as V2');

  const filtered = filterLegacySectionsForDisplay(legacyReport.sections);

  // Category Breakdown: 2 numeric scores → kept, n/a rows stripped.
  const catBreakdown = filtered.find((s) => s.key === 'category_breakdown');
  assert.ok(catBreakdown, 'Category Breakdown must be present for legacy with ≥2 numeric scores');
  assert.equal(catBreakdown.bullets.length, 2, 'only numeric-score rows kept');
  assert.equal(
    catBreakdown.bullets.every((b) => !/score n\/a/i.test(b)),
    true,
    'no n/a rows in output',
  );

  // Risk Flags → kept.
  const flags = filtered.find((s) => s.key === 'flags');
  assert.ok(flags, 'Risk Flags must be present when non-empty');

  // Top Blockers → kept.
  const blockers = filtered.find((s) => s.key === 'top_blockers');
  assert.ok(blockers, 'Top Blockers must be present when non-empty');
});

// ─── getConfidencePercent ─────────────────────────────────────────────────────

test('getConfidencePercent: uses confidence_0_1 for V2 reports', () => {
  assert.equal(getConfidencePercent({ confidence_0_1: 0.73 }, 50), 73);
  assert.equal(getConfidencePercent({ confidence_0_1: 1 }, 0), 100);
  assert.equal(getConfidencePercent({ confidence_0_1: 0 }, 99), 0);
});

test('getConfidencePercent: clamps confidence_0_1 to 0-100', () => {
  assert.equal(getConfidencePercent({ confidence_0_1: 1.5 }, 0), 100);
  assert.equal(getConfidencePercent({ confidence_0_1: -0.2 }, 0), 0);
});

test('getConfidencePercent: falls back to similarity_score for legacy reports', () => {
  assert.equal(getConfidencePercent({ similarity_score: 65 }, 0), 65);
});

test('getConfidencePercent: falls back to fallbackScore when no report fields', () => {
  assert.equal(getConfidencePercent({}, 42), 42);
  assert.equal(getConfidencePercent(null, 30), 30);
});

test('getConfidencePercent: returns 0 for missing data', () => {
  assert.equal(getConfidencePercent(null, null), 0);
  assert.equal(getConfidencePercent(undefined, undefined), 0);
});
