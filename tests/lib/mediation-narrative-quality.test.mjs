import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessNarrativeSourceDepth,
  validateNarrativeMemo,
} from '../../server/_lib/mediation-narrative.ts';
import { assessReportQuality } from '../../server/_lib/vertex-evaluation-v2.ts';
import { buildMediationReviewPresentation } from '../../server/routes/document-comparisons/_helpers.ts';

function referralFactSheet(overrides = {}) {
  return {
    project_goal: 'Test a SaaS referral and implementation partnership through a six-month pilot.',
    scope_deliverables: [
      'Registered referral process',
      'Referral commission',
      'Recurring revenue share for active support',
      'Separate implementation fees',
      'Training and customer handoff',
    ],
    timeline: { start: null, duration: 'six months', milestones: ['Pilot review'] },
    constraints: ['Non-exclusive during the pilot'],
    success_criteria_kpis: ['Qualified referrals and completed customer handoffs'],
    vendor_preferences: [],
    assumptions: ['Both sides can support onboarding'],
    risks: [{ risk: 'Client attribution disputes', impact: 'high', likelihood: 'med' }],
    open_questions: [
      'When is commission earned?',
      'How long does client protection last?',
      'How are direct sales handled?',
    ],
    missing_info: ['Renewal and termination treatment are not defined.'],
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

function referralEvidencePacket() {
  return {
    retrieval_strategy: 'heuristic_commercial_terms_v1',
    evidence_count: 3,
    omitted_evidence_count: 0,
    token_budget_used: 210,
    character_budget_used: 840,
    retrieval_warnings: [],
    generated_at: '2026-06-13T00:00:00.000Z',
    items: [
      {
        id: 'shared:referrals',
        source_type: 'shared_contribution',
        source_label: 'Shared proposal',
        source_role: 'proposer',
        visibility: 'shared',
        relevance_score: 94,
        title_or_summary: 'Referral economics',
        excerpt:
          'The current proposal uses registered referrals, a six-month non-exclusive pilot, and commission after customer payment.',
        extracted_terms: ['economics', 'customer_attribution', 'performance_and_timing'],
        confidence: 0.9,
        include_reason: 'current commercial terms',
        limitations: [],
      },
      {
        id: 'shared:protection',
        source_type: 'shared_contribution',
        source_label: 'Counterparty comments',
        source_role: 'recipient',
        visibility: 'shared',
        relevance_score: 92,
        title_or_summary: 'Client protection concern',
        excerpt:
          'The counterparty comments request a client-protection window, non-circumvention treatment, and direct-sell rules for existing prospects.',
        extracted_terms: ['customer_attribution', 'rights_and_control'],
        confidence: 0.9,
        include_reason: 'counterparty concern',
        limitations: [],
      },
      {
        id: 'shared:delivery',
        source_type: 'shared_contribution',
        source_label: 'Latest draft',
        source_role: 'proposer',
        visibility: 'shared',
        relevance_score: 88,
        title_or_summary: 'Implementation responsibilities',
        excerpt:
          'The latest draft separates implementation fees from referral commission and assigns training, onboarding, product support, and customer handoff responsibilities.',
        extracted_terms: ['economics', 'obligations_and_risk'],
        confidence: 0.9,
        include_reason: 'operating responsibilities',
        limitations: [],
      },
    ],
  };
}

function internalAnalysis() {
  return {
    recommendation: 'Proceed with conditions',
    confidence: 0.67,
    decision_status: 'proceed_with_conditions',
    core_thesis: 'The pilot is workable if attribution, protection, and ongoing economics are documented.',
    commercial_rationale: ['The pilot bounds commitment while testing referral and implementation value.'],
    strongest_arguments_for: ['Both sides support a referral and implementation relationship.'],
    strongest_arguments_against: ['Customer ownership and recurring economics remain open.'],
    key_risks: ['An introduced customer could create competing commission claims.'],
    hidden_assumptions: ['Both sides can track referrals consistently.'],
    unresolved_questions: ['When is commission earned?', 'How long does protection last?'],
    negotiation_leverage: ['A non-exclusive pilot limits initial dependency.'],
    suggested_next_actions: ['Draft pilot rules of engagement.'],
    evidence_used: [
      '[shared:referrals] The proposal supports a registered six-month pilot.',
      '[shared:protection] The counterparty requests client protection and direct-sell rules.',
      '[shared:delivery] The latest draft separates implementation and referral economics.',
    ],
    evidence_gaps: ['Renewal and termination treatment remain undefined.'],
    unsupported_claims: [],
    grounding_summary: 'Current shared terms support a conditional pilot, with customer and economic rules open.',
    retrieval_warnings: [],
    missing_information: ['Renewal and termination treatment.'],
    tone_profile: 'constructive',
    output_mode: 'balanced_assessment',
  };
}

const substantiveParagraphs = [
  'The current proposal supports continuing with a conditional six-month pilot because both sides have described a real referral relationship rather than a vague promise to collaborate. Registered introductions, referral commission, implementation support, training, and a post-pilot review create a commercially intelligible test. The pilot is therefore worth pursuing, but the shared materials do not yet support an unconditional launch. The recommendation depends on converting the broad channel intent into rules that can be applied to a specific account without either side having to reconstruct the original conversation months later.',
  'The available record also shows why the relationship could create value for each side. The SaaS company appears to gain qualified access to customers and additional implementation capacity without building a large channel operation immediately. The consulting partner appears to gain commission income and a separate path to paid implementation work. Those interests are compatible while the pilot remains non-exclusive. They become harder to reconcile if referral economics, implementation economics, and customer ownership are blended together, because each side could then believe it earned value that the other side regards as part of its ordinary role.',
  'The counterparty comments make client protection more than a drafting detail. They ask for protection against being bypassed after an introduction, while the current proposal preserves the SaaS company’s ability to sell directly. Both positions are commercially understandable. The missing rule is the boundary between a genuinely introduced opportunity and an account already being pursued independently. Without a registration and challenge process, later evidence will be ambiguous: an email introduction, a qualified meeting, an active opportunity, and a paid subscription could each be treated as the event that created entitlement.',
  'Commission should therefore be linked to an observable trigger. The shared materials mention referral commission, but they do not establish whether it is earned at introduction, qualification, contract signature, customer payment, or completed onboarding. That distinction changes cash flow, cancellation risk, and the amount of work the partner must perform before earning anything. If commission is earned only after payment, then the partner needs transparent status updates. If it is earned earlier, then the SaaS company needs rules for failed or refunded transactions. The recommendation remains conditional until that trigger and the payment timetable are documented.',
  'Recurring revenue share needs a different justification from the initial referral payment. The available evidence suggests that continuing economics are connected to active ongoing support, but it does not define the activity required or the period covered. A fair structure would distinguish a one-time introduction from continuing customer work. If the partner remains involved in training, adoption, expansion, or support that can be evidenced, a bounded recurring share may reflect continuing value. If the partner stops contributing after handoff, an open-ended share would impose cost without a matching obligation and would likely become a source of resentment.',
  'Implementation fees should remain separate from referral economics because the latest draft treats implementation as identifiable work. The parties should state what belongs in standard onboarding, what can be sold as separately paid consulting, who approves that work, and who owns product support after handoff. This protects the partner from performing unpriced delivery work and protects the SaaS company from customers being promised services it has not approved. It also makes the customer experience easier to manage, because sales, onboarding, implementation, training, and ongoing support each have a named owner rather than a shared but undefined responsibility.',
  'Renewal, expansion, and termination rules also need to follow the commercial logic of the pilot. The shared materials do not establish whether commission or continuing revenue share survives termination, applies to customer expansion, or ends when active support stops. A balanced rule would preserve earned amounts for properly registered customers while preventing indefinite economics on accounts the partner no longer supports. The parties should also agree what happens to active introductions if the pilot ends, who may contact those customers, and how records are handed over. These provisions matter because a successful pilot will create value after the initial six months, while an unsuccessful one still needs an orderly exit that does not expose either side to disputed ownership claims.',
  'A workable bridge is a non-exclusive pilot using registered referrals, a short acceptance window for pre-existing opportunities, a defined client-protection period, and direct-sell exceptions recorded at registration. Commission would be earned on an agreed customer event and paid on a stated timetable. Recurring revenue share would apply only while documented support continues. Implementation services would follow a separate fee and approval path. This package does not decide every long-term channel question, but it turns the current proposal into a testable operating model and avoids granting semi-exclusivity before either side has evidence of performance.',
  'The pilot review should use measurable evidence rather than general satisfaction. The parties could assess the number and quality of registered referrals, conversion into paid customers, implementation outcomes, support activity, and whether attribution disputes occurred. Semi-exclusivity or improved recurring economics should be available only after a stated performance threshold. If the pilot produces qualified referrals and reliable handoffs, the case for broader rights becomes stronger. If activity is low or customers experience confusion about ownership, the parties can end or redesign the arrangement without arguing that the original enthusiasm created a permanent commitment.',
  'The practical next move is to draft a one-page Pilot Rules of Engagement before debating long-term percentages. That document should cover referral qualification, registration, pre-existing accounts, client protection, bypass rules, commission earning and payment, renewal and expansion treatment, implementation fee ownership, support evidence, termination, and the post-pilot review. The negotiation history indicates that these mechanics, rather than the basic desire to work together, are the real source of risk. Closing them in one working session would give both sides a common operating record and would make any later economic negotiation materially more informed.',
];

function substantiveNarrative() {
  return {
    title: 'A workable channel pilot, once customer and economic rules are explicit',
    sections: [
      { heading: 'Why the pilot is worth pursuing', paragraphs: substantiveParagraphs.slice(0, 3) },
      { heading: 'Where the commercial risk sits', paragraphs: substantiveParagraphs.slice(3, 6) },
      { heading: 'A balanced pilot structure', paragraphs: substantiveParagraphs.slice(6, 8) },
      { heading: 'What the record requires next', paragraphs: substantiveParagraphs.slice(8) },
    ],
    closing:
      'Draft and agree the one-page Pilot Rules of Engagement before launch, then use measured referral and support performance to decide whether broader economics or semi-exclusivity are justified.',
  };
}

function report(narrative, missing) {
  return {
    analysis_stage: 'mediation_review',
    fit_level: 'medium',
    confidence_0_1: 0.67,
    why: [
      'Recommendation: Proceed with conditions because the current proposal supports a bounded pilot but leaves customer and economic rules unresolved.',
      'Where the Parties Align: Both sides support referrals, implementation support, training, and a six-month test.',
      'Where the Deal Is Stuck: Attribution, client protection, commission triggers, recurring economics, and direct-sale treatment remain open.',
      'Suggested Bridge: Use registered referrals, a protection window, separate implementation fees, and performance-based post-pilot rights.',
      'Next Step: Draft and agree a one-page Pilot Rules of Engagement before launch.',
    ],
    missing,
    redactions: [],
    internal_analysis: internalAnalysis(),
    narrative,
  };
}

const completeMissing = [
  'What counts as a qualified referral? — determines whether an introduction is eligible for attribution.',
  'When is commission earned and paid? — determines the economic trigger and payment timing.',
  'How long does client protection last? — determines when an introduced account remains protected.',
  'How are pre-existing opportunities and direct sales handled? — prevents competing ownership claims.',
  'When does recurring revenue share apply? — links continuing economics to active support.',
  'Who owns onboarding, implementation, training, and support? — separates included work from paid consulting.',
];

test('adequate referral evidence requires a substantive evidence-linked memo', () => {
  const packet = referralEvidencePacket();
  const depth = assessNarrativeSourceDepth({
    factSheet: referralFactSheet(),
    retrievedEvidencePacket: packet,
  });
  assert.equal(depth.adequate, true);

  const shortNarrative = {
    title: 'A workable pilot with conditions',
    sections: [
      {
        heading: 'The commercial picture',
        paragraphs: [
          'The current proposal supports a pilot, but attribution and payment rules remain unresolved.',
          'The parties should define client protection before launch.',
        ],
      },
      {
        heading: 'A practical route',
        paragraphs: ['Use registered referrals and document the commission trigger.'],
      },
    ],
    closing: 'Draft the pilot rules before proceeding.',
  };
  const quality = assessReportQuality(
    report(shortNarrative, completeMissing),
    referralFactSheet(),
    packet,
  );

  assert.equal(
    quality.triggers.some((entry) => entry.startsWith('narrative_too_short_for_available_evidence')),
    true,
  );
  assert.equal(
    quality.triggers.some((entry) => entry.startsWith('narrative_too_compressed_for_available_evidence')),
    true,
  );
});

test('substantive referral memo passes length, evidence-link, and open-question checks', () => {
  const narrative = substantiveNarrative();
  const validation = validateNarrativeMemo(narrative, {
    fitLevel: 'medium',
    decisionStatus: 'proceed_with_conditions',
    missingCount: completeMissing.length,
    validateContentAlignment: true,
  });
  const quality = assessReportQuality(
    report(narrative, completeMissing),
    referralFactSheet(),
    referralEvidencePacket(),
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.metrics.word_count >= 1_000, true);
  assert.equal(
    quality.triggers.some((entry) => entry.startsWith('narrative_too_short_for_available_evidence')),
    false,
  );
  assert.equal(quality.triggers.includes('recommendation_not_linked_to_supplied_evidence'), false);
  assert.equal(quality.triggers.includes('open_questions_miss_deal_critical_evidence_gaps'), false);
});

test('thin material permits a shorter memo only when the limitation and missing information are explicit', () => {
  const thinFactSheet = referralFactSheet({
    project_goal: 'Explore a possible partnership.',
    scope_deliverables: [],
    timeline: { start: null, duration: null, milestones: [] },
    constraints: [],
    success_criteria_kpis: [],
    assumptions: [],
    risks: [],
    open_questions: [],
    missing_info: [],
    source_coverage: {
      has_scope: false,
      has_timeline: false,
      has_kpis: false,
      has_constraints: false,
      has_risks: false,
    },
  });
  const thinNarrative = {
    title: 'A preliminary view from a limited record',
    sections: [
      {
        heading: 'What can be said now',
        paragraphs: [
          'The available record is limited, so this should be treated as a preliminary review rather than a reliable recommendation. It establishes interest in a partnership but does not define the commercial model.',
          'The source material is incomplete on economics, customer ownership, obligations, timing, and exit rights. Those gaps prevent a fuller assessment of whether the relationship is workable.',
        ],
      },
      {
        heading: 'Information needed',
        paragraphs: [
          'The parties need to provide the proposed payment model, referral or customer rules, each side’s responsibilities, the intended pilot period, and the circumstances in which either side can stop.',
        ],
      },
    ],
    closing: 'Collect those terms before asking either side to make a commercial commitment.',
  };
  const quality = assessReportQuality(
    report(thinNarrative, [
      'What commercial model is proposed? — determines how value and cost are allocated.',
      'What responsibilities would each side accept? — determines whether the arrangement is feasible.',
    ]),
    thinFactSheet,
  );

  assert.equal(quality.triggers.includes('thin_source_narrative_does_not_explain_limitations'), false);
});

test('section-content alignment rejects action prose under an unresolved-question heading', () => {
  const validation = validateNarrativeMemo({
    title: 'A conditional pilot',
    sections: [
      {
        heading: 'Why the pilot could work',
        paragraphs: [
          'The current proposal supports a bounded referral pilot with implementation support.',
          'The available record identifies enough common ground to continue conditionally.',
        ],
      },
      {
        heading: 'What Still Needs Answering',
        paragraphs: [
          'Move forward once the parties draft the pilot rules and approve the commercial package.',
        ],
      },
    ],
    closing: 'Draft the pilot rules before launch.',
  }, {
    fitLevel: 'medium',
    missingCount: 2,
    validateContentAlignment: true,
  });

  assert.equal(validation.valid, false);
  assert.equal(
    validation.warnings.includes('narrative_question_section_contains_recommendation_or_action'),
    true,
  );
});

test('not-viable decisions reject unqualified workable, plausible, or bridgeable narratives', () => {
  const narrative = substantiveNarrative();
  narrative.title = 'A workable pilot with a realistic landing zone';
  narrative.sections[0].paragraphs[0] =
    'This still looks like a plausible and bridgeable SaaS partnership. A realistic landing zone is a non-exclusive pilot with registered referrals and a client-protection window.';

  const validation = validateNarrativeMemo(narrative, {
    fitLevel: 'low',
    decisionStatus: 'not_viable',
    missingCount: completeMissing.length,
    validateContentAlignment: true,
  });

  assert.equal(validation.valid, false);
  assert.equal(
    validation.warnings.includes('narrative_presents_viable_path_under_not_viable_decision'),
    true,
  );
});

test('not-viable decisions may distinguish the current structure from a materially different alternative', () => {
  const narrative = substantiveNarrative();
  narrative.title = 'The current structure needs a full reset';
  narrative.sections[0].paragraphs[0] =
    'The current structure is not viable as drafted because attribution, customer protection, and economic triggers are not established. A materially different alternative pilot could become workable only after those commercial rules are agreed.';

  const validation = validateNarrativeMemo(narrative, {
    fitLevel: 'low',
    decisionStatus: 'not_viable',
    missingCount: completeMissing.length,
    validateContentAlignment: true,
  });

  assert.equal(
    validation.warnings.includes('narrative_presents_viable_path_under_not_viable_decision'),
    false,
  );
});

test('public narrative rejects references to confidential or internal evidence sources', () => {
  const narrative = substantiveNarrative();
  narrative.sections[0].paragraphs[0] +=
    ' Confidential context suggests the economic gap may be narrower because of internal pipeline pressure.';

  const validation = validateNarrativeMemo(narrative, {
    fitLevel: 'medium',
    decisionStatus: 'proceed_with_conditions',
    missingCount: completeMissing.length,
    validateContentAlignment: true,
  });

  assert.equal(validation.valid, false);
  assert.equal(
    validation.warnings.includes('narrative_mentions_private_or_internal_evidence_source'),
    true,
  );
});

test('quality gate rejects raw evidence IDs in public narrative prose', () => {
  const narrative = substantiveNarrative();
  narrative.sections[0].paragraphs[0] +=
    ' The private grounding reference is shared:referrals.';
  const quality = assessReportQuality(
    report(narrative, completeMissing),
    referralFactSheet(),
    referralEvidencePacket(),
  );

  assert.equal(quality.triggers.includes('narrative_exposes_raw_evidence_id'), true);
});

test('natural renderer preserves the substantive memo and exposes up to six safe open questions', () => {
  const narrative = substantiveNarrative();
  const presentation = buildMediationReviewPresentation({
    fit_level: 'medium',
    confidence_0_1: 0.67,
    why: report(narrative, completeMissing).why,
    missing: completeMissing,
    redactions: [],
    internal_analysis: internalAnalysis(),
    narrative,
  });
  const visibleParagraphs = presentation.presentation_sections.flatMap(
    (section) => section.paragraphs || [],
  );
  const questionSection = presentation.presentation_sections.find(
    (section) => section.key === 'narrative_questions',
  );

  assert.equal(presentation.renderer_path, 'narrative');
  assert.equal(visibleParagraphs.length, substantiveParagraphs.length + 1);
  assert.equal((questionSection?.bullets || []).length, 6);
  assert.doesNotMatch(JSON.stringify(presentation), /shared:referrals|retrieved_evidence_packet|internal_analysis/);
});
