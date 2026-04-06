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
  getRunOpportunityReviewLabel,
  getReviewStageLabel,
  getReviewStatusDetails,
  getSentenceSafePreview,
  parseV2WhyEntry,
  splitV2WhyBodyParagraphs,
  truncateTextAtNaturalBoundary,
  filterLegacySectionsForDisplay,
  getConfidencePercent,
  MEDIATION_REVIEW_LABEL,
  PRE_SEND_REVIEW_LABEL,
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

test('hasV2Report: returns true for pre-send reports with presentation sections', () => {
  assert.equal(
    hasV2Report({
      analysis_stage: 'pre_send_review',
      send_readiness_summary: 'Clarify ownership before sharing.',
      presentation_sections: [
        {
          heading: 'Readiness to Send',
          paragraphs: ['Clarify ownership before sharing.'],
        },
      ],
    }),
    true,
  );
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

test('review copy helpers: expose pre-send labels for unilateral stage', () => {
  assert.equal(PRE_SEND_REVIEW_LABEL, 'Initial Review');
  assert.equal(getReviewStageLabel('pre_send_review'), 'Initial Review');
  assert.equal(
    getRunOpportunityReviewLabel({ stage: 'pre_send_review' }),
    'Run Initial Review',
  );
  assert.equal(
    getRunOpportunityReviewLabel({ stage: 'pre_send_review', hasExisting: true }),
    'Re-run Initial Review',
  );
});

test('review status helpers: expose readiness details for pre-send reports', () => {
  assert.deepEqual(
    getReviewStatusDetails({
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary: 'Clarify acceptance criteria before sharing.',
    }),
    {
      label: 'Ready with Clarifications',
      tone: 'warning',
      explanation: 'Clarify acceptance criteria before sharing.',
    },
  );
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

test('buildStoredV2Evaluation: stores pre-send reviews without mediation fields', () => {
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary: 'Clarify ownership before sharing.',
      missing_information: ['Name the delivery owner.'],
      ambiguous_terms: ['Success metrics are still implied.'],
      likely_recipient_questions: ['Who approves acceptance?'],
      likely_pushback_areas: ['Undefined remediation responsibility.'],
      commercial_risks: ['Pricing does not define change handling.'],
      implementation_risks: ['Integration responsibility remains unclear.'],
      suggested_clarifications: ['Assign ownership and acceptance criteria.'],
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });

  assert.equal(stored.report.analysis_stage, 'pre_send_review');
  assert.equal(stored.report.report_title, 'Initial Review');
  assert.equal(stored.report.readiness_status, 'ready_with_clarifications');
  assert.equal(Array.isArray(stored.report.presentation_sections), true);
  assert.equal('why' in stored.report, false);
  assert.equal('confidence_0_1' in stored.report, false);
  assert.equal('recommendation' in stored.report, false);
});

test('buildStoredV2Evaluation: synthesizes proposer-only sections into a memo-style pre-send report', () => {
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary:
        'The draft is workable, but a vendor would still need clearer scope, sign-off, and pricing assumptions before treating it as a dependable brief.',
      missing_information: [
        'What is included in the initial fixed-price pilot scope?',
        'What measurable acceptance criteria define completion?',
      ],
      ambiguous_terms: [
        'Phase-two pricing remains implied rather than stated.',
        'Documentation remediation responsibility is still described loosely.',
      ],
      likely_recipient_questions: [
        'Who owns data or documentation cleanup before implementation starts?',
      ],
      likely_pushback_areas: [
        'A vendor may resist fixed-price responsibility while scope and remediation remain open.',
      ],
      commercial_risks: [
        'Pricing posture assumes fixed-price certainty before the change process is defined.',
      ],
      implementation_risks: [
        'Documentation quality and remediation ownership remain unclear.',
      ],
      suggested_clarifications: [
        'Define the initial pilot scope, measurable acceptance criteria, and the change process in the current draft.',
      ],
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });

  const headings = stored.report.presentation_sections.map((section) => section.heading);
  assert.deepEqual(headings, [
    'Readiness Summary',
    'What Matters Most',
    'Likely Response From the Other Side',
    'Residual Risks and Points to Tighten',
  ]);
  assert.match(stored.report.primary_insight, /credible commercial brief/i);
  assert.match(stored.report.primary_insight, /fixed-price/i);
  assert.doesNotMatch(headings.join(' | '), /Missing Information|Ambiguous Terms|Likely Recipient Questions|Likely Pushback Areas|Commercial Risks|Implementation Risks/);
  assert.equal(
    stored.report.presentation_sections.every((section) => Array.isArray(section.paragraphs) && section.paragraphs.length > 0),
    true,
  );
  assert.equal(
    stored.report.presentation_sections
      .slice(0, 3)
      .every((section) => !Array.isArray(section.bullets) || section.bullets.length === 0),
    true,
  );
  assert.equal(
    stored.report.presentation_sections
      .filter((section) => Array.isArray(section.bullets))
      .every((section) => section.bullets.length <= 3),
    true,
  );
  assert.doesNotMatch(JSON.stringify(stored.report), /\bPre-send Review\b|\bsender-side\b|\bbefore sending\b/i);
});

test('buildStoredV2Evaluation: keeps pre-send readiness summary concise and avoids raw "before sending" action copy', () => {
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary:
        'This draft is already a credible commercial brief for discussion, with only limited clarifications left before the parties ask for fixed-price pilot pricing.',
      missing_information: [
        'What is included in the initial fixed-price pilot scope?',
        'What measurable acceptance criteria define completion?',
      ],
      ambiguous_terms: [
        'Phase-two pricing remains implied rather than stated.',
        'Documentation remediation responsibility is still described loosely.',
      ],
      likely_recipient_questions: [
        'Who owns data or documentation cleanup before implementation starts?',
      ],
      likely_pushback_areas: [
        'A vendor may resist fixed-price responsibility while scope and remediation remain open.',
      ],
      commercial_risks: [
        'Pricing posture assumes fixed-price certainty before the change process is defined.',
      ],
      implementation_risks: [
        'Documentation quality and remediation ownership remain unclear.',
      ],
      suggested_clarifications: [
        'Define the initial pilot scope, measurable acceptance criteria, and the change process before sharing.',
      ],
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });

  const readinessSection = stored.report.presentation_sections.find((section) => section.heading === 'Readiness Summary');
  const clarificationSection = stored.report.presentation_sections.find((section) => section.heading === 'Residual Risks and Points to Tighten');

  assert.equal(readinessSection?.paragraphs?.length, 1);
  assert.match(readinessSection?.paragraphs?.[0] || '', /credible commercial brief/i);
  assert.match(readinessSection?.paragraphs?.[0] || '', /limited clarifications/i);
  assert.doesNotMatch(readinessSection?.paragraphs?.[0] || '', /not yet strong enough/i);
  assert.match((clarificationSection?.paragraphs || []).join(' '), /cleaner fixed-price pilot pricing/i);
  assert.doesNotMatch(clarificationSection?.paragraphs?.[0] || '', /\bBefore sending\b/i);
  assert.equal(
    (clarificationSection?.bullets || []).every((bullet) => !/\bBefore sending\b/i.test(bullet)),
    true,
  );
});

test('buildStoredV2Evaluation: strong proposer-only results lead with strengths and keep residual issues secondary', () => {
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_to_send',
      send_readiness_summary:
        'This is a strong early-stage commercial brief. Scope, milestones, ownership, and acceptance criteria are already well bounded for vendor discussion.',
      missing_information: [],
      ambiguous_terms: [],
      likely_recipient_questions: ['Confirm the preferred weekly steering-call slot.'],
      likely_pushback_areas: ['A vendor may still test support handover timing as part of normal implementation planning.'],
      commercial_risks: [],
      implementation_risks: ['Support handover timing should stay aligned with pilot sign-off.'],
      suggested_clarifications: ['Keep the support handover timing aligned with pilot sign-off when sharing the draft.'],
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });

  const readinessSection = stored.report.presentation_sections.find((section) => section.heading === 'Readiness Summary');
  const gapsSection = stored.report.presentation_sections.find((section) => section.heading === 'What Matters Most');
  const pushbackSection = stored.report.presentation_sections.find((section) => section.heading === 'Likely Response From the Other Side');

  assert.match(stored.report.primary_insight, /strong early-stage commercial brief/i);
  assert.match(readinessSection?.paragraphs?.[0] || '', /ready for external discussion/i);
  assert.match(readinessSection?.paragraphs?.[0] || '', /minor clarifications/i);
  assert.match(gapsSection?.paragraphs?.[0] || '', /remaining work/i);
  assert.match(gapsSection?.paragraphs?.[0] || '', /strong overall structure/i);
  assert.match(pushbackSection?.paragraphs?.[0] || '', /ordinary negotiation/i);
  assert.doesNotMatch(stored.report.presentation_sections.map((section) => section.heading).join(' | '), /Recommendation|Confidence/i);
  assert.doesNotMatch((readinessSection?.paragraphs || []).join(' '), /not yet strong enough|fundamentally weak/i);
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

test('buildMediationReviewPresentation: keeps bilateral recommendation framing and does not reuse pre-send memo headings', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.64,
    why: [
      'Executive Summary: The proposal is workable if the remaining commercial guardrails are clarified.',
      'Decision Assessment: Risk Summary: The main issues remain around change control and acceptance ownership.\n\nKey Strengths: The phased structure and rollout intent are already visible.',
      'Decision Readiness: Decision status: Proceed with conditions. A viable path exists if scope and approval mechanics are tightened.',
      'Recommended Path: Recommended path: resolve the remaining approval and change-control issues before final commitment.',
    ],
    missing: ['Who owns change approval and final sign-off? — determines whether the commitment path is governable.'],
    redactions: [],
  });

  const headings = presentation.presentation_sections.map((section) => section.heading);
  assert.equal(headings.includes('Recommendation'), true);
  assert.equal(headings.includes('Readiness Summary'), false);
  assert.equal(headings.includes('Residual Risks and Points to Tighten'), false);
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

test('buildMediationReviewPresentation: uses direct top-level V2 sections for sharper strengths, risks, and lead insight', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.63,
    why: [
      'Executive Summary: The draft is commercially promising, but delivery ownership remains underdefined.',
      'Key Strengths: Renewal economics and commercial scope are already aligned.',
      'Key Risks: Timeline ownership and change-control mechanics remain unsettled.',
      'Structural tensions: The main tension is launch speed versus approval control.',
      'Decision Readiness: Decision status: Proceed with conditions. Timeline ownership still needs to be made explicit.',
      'Recommended Path: Recommended path: resolve timeline ownership before final approval.',
    ],
    missing: ['Who owns the final launch timeline? — determines implementation accountability.'],
    redactions: [],
  });

  assert.equal(
    presentation.primary_insight,
    'The draft is commercially promising, but delivery ownership remains underdefined.',
  );
  assert.deepEqual(
    presentation.presentation_sections.find((section) => section.key === 'areas_of_strength')?.paragraphs,
    ['Renewal economics and commercial scope are already aligned.'],
  );
  assert.deepEqual(
    presentation.presentation_sections.find((section) => section.key === 'areas_of_concern')?.paragraphs,
    ['Timeline ownership and change-control mechanics remain unsettled.'],
  );
  assert.deepEqual(
    presentation.presentation_sections.find((section) => section.key === 'key_trade_offs')?.paragraphs,
    ['The main tension is launch speed versus approval control.'],
  );
});

test('buildMediationReviewPresentation: folds compatibility metadata into the primary insight without changing the report shape', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.65,
    why: [
      'Executive Summary: The draft is workable if the remaining governance gap is resolved.',
      'Decision Readiness: Decision status: Proceed with conditions. Governance ownership still needs final agreement.',
      'Recommended Path: Recommended path: resolve governance ownership before final commitment.',
    ],
    missing: ['Who owns governance approvals? — determines whether the commitment path is workable.'],
    redactions: [],
    negotiation_analysis: {
      proposing_party: {
        demands: ['Predictable approval path'],
        priorities: ['Timeline certainty'],
        dealbreakers: [{ text: 'Undefined governance ownership', basis: 'strongly_implied' }],
        flexibility: ['Optional reporting detail can move later'],
      },
      counterparty: {
        demands: ['Budget discipline'],
        priorities: ['Governance clarity'],
        dealbreakers: [{ text: 'Open-ended approval exposure', basis: 'stated' }],
        flexibility: ['Milestone sequencing may be negotiable'],
      },
      compatibility_assessment: 'compatible_with_adjustments',
      compatibility_rationale:
        'The parties appear compatible with adjustments if governance ownership and budget guardrails are clarified.',
      bridgeability_notes: ['Clarify governance ownership before final commitment.'],
      critical_incompatibilities: ['Governance ownership is still unresolved.'],
    },
  });

  assert.equal(typeof presentation.primary_insight, 'string');
  assert.match(presentation.primary_insight, /compatible with adjustments|governance ownership/i);
  assert.equal(Array.isArray(presentation.presentation_sections), true);
  assert.equal(presentation.presentation_sections.length > 0, true);
});

test('buildMediationReviewPresentation: keeps soft preferences from being presented as clear non-negotiables', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'high',
    confidence_0_1: 0.77,
    why: [
      'Executive Summary: The draft is directionally workable and the main remaining issue is sequencing detail.',
      'Decision Readiness: Decision status: Proceed with conditions. Sequencing still needs clarification before final commitment.',
      'Recommended Path: Recommended path: confirm sequencing and move forward.',
    ],
    missing: ['How should phase-two sequencing be confirmed? — determines whether the current path can be finalised cleanly.'],
    redactions: [],
    negotiation_analysis: {
      proposing_party: {
        demands: ['Practical sequencing plan'],
        priorities: ['Timeline certainty'],
        dealbreakers: [{ text: 'Timeline certainty', basis: 'not_clearly_established' }],
        flexibility: ['Reporting detail can follow after launch'],
      },
      counterparty: {
        demands: ['Governance visibility'],
        priorities: ['Approval confidence'],
        dealbreakers: [{ text: 'Approval confidence', basis: 'not_clearly_established' }],
        flexibility: ['Milestone packaging may be adjustable'],
      },
      compatibility_assessment: 'compatible_with_adjustments',
      compatibility_rationale:
        'The parties appear compatible with adjustments if sequencing and approval checkpoints are clarified.',
      bridgeability_notes: ['Confirm sequencing before final commitment.'],
      critical_incompatibilities: [],
    },
  });

  const whyItWorks = presentation.presentation_sections.find((section) => section.key === 'why_it_works')?.paragraphs || [];
  const rendered = whyItWorks.join(' ');

  assert.match(rendered, /timeline certainty|approval confidence/i);
  assert.doesNotMatch(rendered, /non-negotiable/i);
});

test('buildMediationReviewPresentation: treats unsupported incompatibility claims as uncertainty rather than a hard clash', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.56,
    why: [
      'Executive Summary: The draft still needs governance and sequencing detail before compatibility can be judged confidently.',
      'Decision Readiness: Decision status: Explore further. The visible issue is missing clarity rather than a confirmed deadlock.',
      'Recommended Path: Recommended path: resolve the open governance and sequencing questions first.',
    ],
    missing: ['Who owns governance sequencing? — determines whether the parties can align the decision path.'],
    redactions: [],
    negotiation_analysis: {
      proposing_party: {
        demands: ['Governance sequencing clarity'],
        priorities: ['Timeline certainty'],
        dealbreakers: [{ text: 'Timeline certainty', basis: 'not_clearly_established' }],
        flexibility: ['Packaging of later milestones can move'],
      },
      counterparty: {
        demands: ['Approval clarity'],
        priorities: ['Governance visibility'],
        dealbreakers: [{ text: 'Governance visibility', basis: 'not_clearly_established' }],
        flexibility: ['Reporting detail can move behind signature'],
      },
      compatibility_assessment: 'fundamentally_incompatible',
      compatibility_rationale: 'The parties are fundamentally incompatible.',
      bridgeability_notes: ['Clarify governance sequencing first.'],
      critical_incompatibilities: [],
    },
  });

  assert.match(presentation.primary_insight, /not yet clear|clarification|missing/i);
  assert.doesNotMatch(presentation.primary_insight, /fundamental incompat/i);
});

test('buildMediationReviewPresentation: keeps strategic tensions distinct from strategic implications', () => {
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.69,
    why: [
      'Executive Summary: The structure is workable, but the trade-off depends on sequencing governance and rollout flexibility carefully.',
      'Negotiation Insights: Likely priorities: one side is pushing for rollout speed while the other is prioritising approval control.\n\nStructural tensions: The central tension is launch speed versus approval control.\n\nPossible concessions: optional work can move behind the first milestone.',
      'Leverage Signals: Leverage signal: both sides want movement, but each is trying to shift more approval risk to the other side.',
      'Potential Deal Structures: A phased structure could work if governance gates and dependency checkpoints are sequenced up front.',
      'Decision Readiness: Decision status: Proceed with conditions. The path is credible if governance sequencing is clarified.',
      'Recommended Path: Recommended path: align sequencing, approvals, and rollout scope in one bounded package.',
    ],
    missing: ['Who approves phase-two expansion? — determines governance control.'],
    redactions: [],
  });

  const tensions = presentation.presentation_sections.find((section) => section.key === 'key_tensions')?.paragraphs || [];
  const implications = presentation.presentation_sections.find((section) => section.key === 'strategic_implications')?.paragraphs || [];

  assert.equal(tensions.some((paragraph) => /tension|approval control|rollout speed/i.test(paragraph)), true);
  assert.equal(
    implications.some((paragraph) => /approval risk|phased structure|dependency checkpoints/i.test(paragraph)),
    true,
  );
  assert.notDeepEqual(tensions, implications);
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
      negotiation_analysis: {
        proposing_party: {
          demands: ['Named launch owner'],
          priorities: ['Timeline certainty'],
          dealbreakers: [{ text: 'Undefined launch ownership', basis: 'strongly_implied' }],
          flexibility: ['Optional reporting can move behind go-live'],
        },
        counterparty: {
          demands: ['Budget guardrails'],
          priorities: ['Governance clarity'],
          dealbreakers: [{ text: 'Open-ended liability', basis: 'stated' }],
          flexibility: ['Milestone sequencing may be negotiable'],
        },
        compatibility_assessment: 'compatible_with_adjustments',
        compatibility_rationale:
          'The parties appear compatible with adjustments if launch ownership and budget guardrails are clarified.',
        bridgeability_notes: ['Clarify launch ownership before final commitment.'],
        critical_incompatibilities: ['Launch ownership is still unresolved.'],
      },
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
  assert.equal(stored.report.negotiation_analysis.compatibility_assessment, 'compatible_with_adjustments');
  assert.match(stored.report.primary_insight, /compatible with adjustments|launch ownership/i);
  assert.equal(typeof stored.report.primary_insight, 'string');
  assert.equal(Array.isArray(stored.report.presentation_sections), true);
  assert.equal(stored.report.presentation_sections.length > 0, true);
});

test('buildStoredV2Evaluation: later bilateral rounds stay mediation_review while adding progress-aware metadata', () => {
  const stored = buildStoredV2Evaluation(
    {
      generation_model: 'gemini-test',
      model: 'gemini-provider-test',
      data: {
        analysis_stage: 'mediation_review',
        fit_level: 'medium',
        confidence_0_1: 0.66,
        why: [
          'Executive Summary: The negotiation is closer to agreement now that implementation sequencing is largely aligned.',
          'Decision Assessment: Risk Summary: Commercial acceptance criteria and final approval ownership still need tightening.\n\nKey Strengths: The parties now appear aligned on sequencing and rollout structure.',
          'Negotiation Insights: Likely priorities: both sides appear focused on commercial certainty and accountable sign-off.\n\nPossible concessions: optional reporting detail may be deferred.\n\nStructural tensions: the main tension is commercial acceptance criteria versus launch speed.',
          'Leverage Signals: Leverage signal: both sides have reasons to keep momentum because implementation structure is no longer the main blocker.',
          'Potential Deal Structures: Option A — lock acceptance criteria now and keep the phased rollout.\n\nOption B — use a milestone gate for final approval ownership.\n\nOption C — defer lower-priority reporting obligations until after launch.',
          'Decision Readiness: Decision status: Proceed with conditions. Commercial acceptance criteria still need final agreement.\n\nWhat must be agreed now vs later: lock acceptance criteria and final approval ownership now.\n\nWhat would change the verdict: a bounded sign-off path would raise confidence.',
          'Recommended Path: Recommended path: use the next round to close the remaining commercial deltas.',
        ],
        missing: [
          'What commercial acceptance criteria trigger final sign-off? — determines whether execution can move without reopening price or scope.',
        ],
        redactions: [],
        delta_summary:
          'Since the prior bilateral round, implementation sequencing has narrowed materially, but commercial acceptance criteria remain open.',
        resolved_since_last_round: ['Implementation sequencing is now substantially aligned.'],
        new_open_issues: ['Final approval ownership is now more explicit, but still not fully agreed.'],
        movement_direction: 'converging',
      },
    },
    {
      mediationRoundContext: {
        current_bilateral_round_number: 2,
        prior_bilateral_round_id: 'eval_prev_2',
        prior_bilateral_round_number: 1,
        prior_primary_insight:
          'The first bilateral review found the structure workable, but implementation sequencing and commercial acceptance remained open.',
        prior_missing: [
          'Who owns implementation sequencing?',
          'What commercial acceptance criteria trigger final sign-off?',
        ],
      },
    },
  );

  assert.equal(stored.report.analysis_stage, 'mediation_review');
  assert.equal(stored.report.bilateral_round_number, 2);
  assert.equal(stored.report.prior_bilateral_round_id, 'eval_prev_2');
  assert.equal(stored.report.movement_direction, 'converging');
  assert.match(stored.report.delta_summary, /implementation sequencing/i);
  assert.equal(
    stored.report.presentation_sections.some((section) => section.heading === 'Progress Since Prior Review'),
    true,
  );
  assert.equal(
    stored.report.presentation_sections.some((section) => section.heading === 'Recommendation'),
    true,
  );
});

test('buildStoredV2Evaluation: later bilateral rounds infer convergence from delta summary when movement is omitted', () => {
  const stored = buildStoredV2Evaluation(
    {
      ok: true,
      generation_model: 'gemini-test',
      model: 'gemini-provider-test',
      data: {
        analysis_stage: 'mediation_review',
        fit_level: 'medium',
        confidence_0_1: 0.64,
        why: [
          'Executive Summary: The negotiation is closer to agreement because sequencing is largely settled, while commercial acceptance criteria remain open.',
          'Decision Assessment: Risk Summary: Commercial acceptance criteria still need closure.\n\nKey Strengths: The implementation path is more concrete than last round.',
          'Negotiation Insights: Likely priorities: both sides want bounded approval mechanics.\n\nPossible concessions: reporting detail may be staged.\n\nStructural tensions: final approval ownership still carries friction.',
          'Leverage Signals: Leverage signal: delivery momentum now favors closing the commercial delta rather than reopening sequencing.',
          'Potential Deal Structures: Option A — keep phased rollout and close sign-off mechanics.\n\nOption B — milestone-based approval. \n\nOption C — narrow phase-one scope further.',
          'Decision Readiness: Decision status: Proceed with conditions. Commercial acceptance criteria still need agreement.\n\nWhat must be agreed now vs later: lock acceptance criteria now.\n\nWhat would change the verdict: a bounded approval path would raise confidence.',
          'Recommended Path: Recommended path: use the next round to close the remaining commercial deltas.',
        ],
        missing: [
          'What commercial acceptance criteria trigger final sign-off? — determines whether execution can proceed without reopening scope.',
        ],
        redactions: [],
        delta_summary:
          'Since the prior bilateral round, implementation sequencing has narrowed materially, but commercial acceptance criteria remain open.',
        resolved_since_last_round: ['Implementation sequencing is now substantially aligned.'],
        remaining_deltas: ['Commercial acceptance criteria still need final agreement.'],
      },
    },
    {
      mediationRoundContext: {
        current_bilateral_round_number: 2,
        prior_bilateral_round_id: 'eval_prev_3',
        prior_bilateral_round_number: 1,
        prior_missing: [
          'Who owns implementation sequencing?',
          'What commercial acceptance criteria trigger final sign-off?',
        ],
      },
    },
  );

  assert.equal(stored.report.analysis_stage, 'mediation_review');
  assert.equal(stored.report.bilateral_round_number, 2);
  assert.equal(stored.report.movement_direction, 'converging');
  assert.match(stored.report.delta_summary, /narrowed materially/i);
});

test('buildStoredV2Evaluation: later bilateral rounds infer convergence from bilateral narrative when progress fields are omitted', () => {
  const stored = buildStoredV2Evaluation(
    {
      ok: true,
      generation_model: 'gemini-test',
      model: 'gemini-provider-test',
      data: {
        analysis_stage: 'mediation_review',
        fit_level: 'medium',
        confidence_0_1: 0.62,
        why: [
          'Executive Summary: The negotiation is closer to agreement because implementation sequencing is now largely aligned, while commercial acceptance criteria remain the main open issue.',
          'Decision Assessment: Risk Summary: Commercial acceptance criteria still need closure.\n\nKey Strengths: The implementation path is more concrete than last round.',
          'Negotiation Insights: Likely priorities: both sides want bounded approval mechanics.\n\nPossible concessions: lower-priority reporting detail can be deferred.\n\nStructural tensions: final approval ownership remains the main friction.',
          'Leverage Signals: Leverage signal: delivery momentum now favors closing the commercial delta rather than reopening sequencing.',
          'Potential Deal Structures: Option A — keep phased rollout and close sign-off mechanics.\n\nOption B — milestone-based approval.\n\nOption C — narrow phase-one scope further.',
          'Decision Readiness: Decision status: Proceed with conditions. Commercial acceptance criteria still need agreement.\n\nWhat must be agreed now vs later: lock acceptance criteria now.\n\nWhat would change the verdict: a bounded approval path would raise confidence.',
          'Recommended Path: Recommended path: use the next round to close the remaining commercial deltas.',
        ],
        missing: [
          'What commercial acceptance criteria trigger final sign-off? — determines whether execution can proceed without reopening scope.',
        ],
        redactions: [],
      },
    },
    {
      mediationRoundContext: {
        current_bilateral_round_number: 2,
        prior_bilateral_round_id: 'eval_prev_4',
        prior_bilateral_round_number: 1,
        prior_missing: [
          'Who owns implementation sequencing?',
          'What commercial acceptance criteria trigger final sign-off?',
        ],
      },
    },
  );

  assert.equal(stored.report.analysis_stage, 'mediation_review');
  assert.equal(stored.report.bilateral_round_number, 2);
  assert.equal(stored.report.movement_direction, 'converging');
  assert.match(stored.report.delta_summary, /Since the prior bilateral round/i);
});

test('buildStoredV2Evaluation: later bilateral rounds infer convergence from shared-text delta when progress fields stay generic', () => {
  const stored = buildStoredV2Evaluation(
    {
      ok: true,
      generation_model: 'gemini-test',
      model: 'gemini-provider-test',
      data: {
        analysis_stage: 'mediation_review',
        fit_level: 'low',
        confidence_0_1: 0.45,
        why: [
          'Executive Summary: the deal is not yet workable on the current record because acceptance criteria are still too loose for reliable sign-off.',
        ],
        missing: [
          'What commercial acceptance criteria trigger final sign-off? — determines whether execution can proceed without reopening scope.',
        ],
        redactions: [],
      },
    },
    {
      mediationRoundContext: {
        current_bilateral_round_number: 2,
        prior_bilateral_round_id: 'eval_prev_5',
        prior_bilateral_round_number: 1,
        prior_missing: [
          'Who owns implementation sequencing?',
          'What commercial acceptance criteria trigger final sign-off?',
        ],
      },
      sharedProgressContext: {
        priorSharedText:
          'Recipient round one adds implementation sequencing, dependency ownership, and rollout checkpoints.',
        currentSharedText:
          'Recipient round two confirms implementation sequencing and narrows the remaining issue to commercial acceptance criteria and final approval ownership.',
      },
    },
  );

  assert.equal(stored.report.analysis_stage, 'mediation_review');
  assert.equal(stored.report.bilateral_round_number, 2);
  assert.equal(stored.report.movement_direction, 'converging');
  assert.match(stored.report.delta_summary, /Since the prior bilateral round/i);
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
    negotiation_analysis: {
      proposing_party: {
        demands: ['Named launch owner'],
        priorities: [`Timeline certainty ${confidentialMarker}`],
        dealbreakers: [{ text: `Undefined ownership ${confidentialMarker}`, basis: 'strongly_implied' }],
        flexibility: ['Optional enhancements can move behind launch'],
      },
      counterparty: {
        demands: ['Budget guardrails'],
        priorities: ['Governance clarity'],
        dealbreakers: [{ text: 'Open-ended liability exposure', basis: 'stated' }],
        flexibility: ['Staged rollout may be acceptable'],
      },
      compatibility_assessment: 'compatible_with_adjustments',
      compatibility_rationale: `The parties appear compatible with adjustments if ${confidentialMarker} is resolved.`,
      bridgeability_notes: [
        'Clarify approval ownership before final commitment.',
        `Clarify ${confidentialMarker} before final commitment.`,
      ],
      critical_incompatibilities: [`${confidentialMarker} blocks clean alignment.`],
    },
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
  assert.equal(projection.public_report.negotiation_analysis.compatibility_assessment, 'compatible_with_adjustments');
  assert.deepEqual(projection.public_report.negotiation_analysis.proposing_party.demands, []);
  assert.deepEqual(projection.public_report.negotiation_analysis.counterparty.priorities, []);
  assert.deepEqual(projection.public_report.negotiation_analysis.bridgeability_notes, [
    'Clarify approval ownership before final commitment.',
  ]);
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
