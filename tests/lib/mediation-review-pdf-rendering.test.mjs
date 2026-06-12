import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderWebParityPdfBuffer } from '../../server/routes/document-comparisons/_pdf.ts';
import { getPresentationSections } from '../../src/lib/aiReportUtils.js';
import {
  buildRecipientSafeEvaluationProjection,
  buildStoredV2Evaluation,
} from '../../server/routes/document-comparisons/_helpers.ts';

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return String(parsed?.text || '');
  } finally {
    await parser.destroy();
  }
}

test('AI mediation web-parity PDF renders dynamic presentation sections and numbered blocking questions', async () => {
  const report = {
    presentation_sections: [
      {
        key: 'core_deal_dynamic',
        heading: 'Core Deal Dynamic',
        paragraphs: [
          'The proposal is workable in principle, but the outcome depends on how the parties balance timeline certainty and approval control.',
        ],
      },
      {
        key: 'blocking_questions',
        heading: 'Blocking Questions',
        bullets: [
          'Who owns third-party integration approvals?',
          'What budget guardrails apply to phase-two expansion?',
        ],
        numbered_bullets: true,
      },
    ],
  };

  const sections = getPresentationSections(report).map((section) => ({
    heading: section.heading,
    paragraphs: section.paragraphs,
    bullets: section.bullets,
    numberedBullets: section.numberedBullets,
  }));

  const buffer = await renderWebParityPdfBuffer({
    title: 'Opportunity',
    subtitle: '',
    comparisonId: 'cmp_dynamic_pdf',
    metrics: [
      { label: 'Recommendation', value: 'Medium' },
      { label: 'Confidence', value: '68%' },
      { label: 'Status', value: 'Proceed with conditions' },
      { label: 'Open Questions', value: '2 items' },
    ],
    timelineItems: [
      { label: 'Opportunity Created', value: 'Mar 25, 2026' },
      { label: 'Last Updated', value: 'Mar 25, 2026' },
    ],
    sections,
  });

  const rawText = await extractPdfText(buffer);
  assert.match(rawText, /CORE DEAL DYNAMIC/);
  assert.match(rawText, /BLOCKING QUESTIONS/);
  assert.match(rawText, /1\.\s*Who owns third-party integration approvals\?/);
  assert.match(rawText, /2\.\s*What budget guardrails apply to phase-two expansion\?/);
});

test('shared intake web-parity PDF uses neutral Stage 1 framing without readiness, recommendation, or confidence labels', async () => {
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'stage1_shared_intake',
      submission_summary:
        'The submitting party appears to be proposing a fixed-scope pilot with milestone approvals, but the current materials still leave ownership and success measures incomplete.',
      scope_snapshot: [
        'A fixed-scope pilot is being proposed.',
        'Milestone approvals and rollout sequencing are visible.',
      ],
      unanswered_questions: [
        'What is included in the initial fixed-scope pilot scope?',
        'What acceptance criteria trigger final approval?',
      ],
      other_side_needed: ['Clarification on ownership of cleanup and any scope corrections that affect the pilot boundary.'],
      discussion_starting_points: ['Confirm the pilot scope boundary, measurable outcomes, and ownership of cleanup work.'],
      intake_status: 'awaiting_other_side_input',
      basis_note:
        'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });
  const sections = [
    {
      heading: 'Shared Intake Scope',
      paragraphs: [
        'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
      ],
    },
    ...getPresentationSections(stored.report).map((section) => ({
      heading: section.heading,
      paragraphs: section.paragraphs,
      bullets: section.bullets,
      numberedBullets: section.numberedBullets,
    })),
  ];

  const buffer = await renderWebParityPdfBuffer({
    title: 'Initial Review',
    subtitle: 'Opportunity',
    comparisonId: 'cmp_presend_pdf',
    metrics: [
      { label: 'Status', value: 'Awaiting response' },
      { label: 'Open Questions', value: '2 items' },
    ],
    timelineItems: [
      { label: 'Opportunity Created', value: 'Apr 4, 2026' },
      { label: 'Last Updated', value: 'Apr 4, 2026' },
    ],
    sections,
  });

  const rawText = await extractPdfText(buffer);
  assert.match(rawText, /Initial Review/);
  assert.match(rawText, /STATUS/);
  assert.match(rawText, /SUBMISSION SUMMARY/);
  assert.match(rawText, /SCOPE SNAPSHOT/);
  assert.match(rawText, /OPEN QUESTIONS/);
  assert.match(rawText, /SUGGESTED CLARIFICATIONS/);
  assert.match(rawText, /DISCUSSION STARTING POINTS/);
  assert.match(rawText, /Awaiting response/);
  assert.match(rawText, /preliminary summary/i);
  assert.doesNotMatch(rawText, /READINESS/);
  assert.doesNotMatch(rawText, /RECOMMENDATION/);
  assert.doesNotMatch(rawText, /CONFIDENCE/);
  assert.doesNotMatch(rawText, /LIKELY RESPONSE FROM THE OTHER SIDE|RESIDUAL RISKS AND POINTS TO TIGHTEN/i);
  assert.doesNotMatch(rawText, /\bPre-send Review\b|\bIntake Status\b|\bsender-side\b|\bbefore sending\b/i);
});

test('recipient mediation PDF uses natural narrative and never renders internal analysis', async () => {
  const confidentialMarker = 'PRIVATE_INTERNAL_THESIS_771';
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'mediation_review',
      fit_level: 'medium',
      confidence_0_1: 0.64,
      why: [
        'Recommendation: Continue only after referral attribution and client protection are agreed.',
        'Where the Parties Align: Both sides support a six-month referral pilot with implementation support.',
        'Where the Deal Is Stuck: Commission timing and the client-protection window remain unresolved.',
        'Suggested Bridge: Use registered referrals, a protection period, and separate implementation fees.',
        'Next Step: Record the pilot rules before final commitment.',
      ],
      missing: [
        'When is commission earned? — determines payment timing.',
        'How long does client protection last? — determines attribution certainty.',
      ],
      redactions: [],
      internal_analysis: {
        recommendation: 'Proceed with conditions',
        confidence: 0.64,
        decision_status: 'proceed_with_conditions',
        core_thesis: confidentialMarker,
        commercial_rationale: [],
        strongest_arguments_for: [],
        strongest_arguments_against: [],
        key_risks: [],
        hidden_assumptions: [],
        unresolved_questions: [],
        negotiation_leverage: [],
        suggested_next_actions: [],
        evidence_used: [],
        missing_information: [],
        tone_profile: 'constructive',
        output_mode: 'executive_memo',
      },
      narrative: {
        title: 'A workable referral pilot, once ownership rules are explicit',
        sections: [
          {
            heading: 'Why the pilot is commercially plausible',
            paragraphs: [
              'Both sides support a six-month referral relationship and an implementation role, which creates enough common ground to test customer demand before either side grants broader channel rights. The bounded term limits the initial commitment while preserving a path to expand if the evidence is positive.',
              'The software company gains qualified introductions and implementation capacity, while the consulting partner can earn referral commission and separately priced implementation work. That division is coherent if customer attribution is documented rather than left to memory.',
            ],
          },
          {
            heading: 'The mechanics that still matter',
            paragraphs: [
              'Commission timing and the client-protection window remain unresolved. If those terms stay open, each side can reasonably believe it owns the same account or is entitled to a different payment event.',
              'A registered-referral process, a defined protection period, separate implementation fees, and recurring revenue share tied to documented support would create a practical conditional path without granting exclusivity upfront.',
            ],
          },
        ],
        closing:
          'Draft the referral-registration, client-protection, commission, implementation-fee, and support rules before final commitment.',
      },
    },
    model: 'test-model',
    generation_model: 'test-model',
  });
  const projection = buildRecipientSafeEvaluationProjection({
    evaluationResult: stored,
    publicReport: stored.report,
    confidentialText: confidentialMarker,
    sharedText: 'Shared six-month referral pilot with implementation support.',
    title: 'Referral Partnership',
  });

  assert.equal('internal_analysis' in projection.public_report, false);
  assert.equal(projection.public_report.renderer_path, 'narrative');
  const sections = getPresentationSections(projection.public_report).map((section) => ({
    heading: section.heading,
    paragraphs: section.paragraphs,
    bullets: section.bullets,
    numberedBullets: section.numberedBullets,
  }));
  const buffer = await renderWebParityPdfBuffer({
    title: 'Referral Partnership',
    subtitle: '',
    comparisonId: 'cmp_natural_pdf',
    metrics: [
      { label: 'Recommendation', value: 'Medium' },
      { label: 'Confidence', value: '65%' },
    ],
    timelineItems: [],
    sections,
  });
  const rawText = await extractPdfText(buffer);
  assert.match(rawText, /WHY THE PILOT IS COMMERCIALLY PLAUSIBLE/);
  assert.doesNotMatch(rawText, new RegExp(confidentialMarker));
  assert.doesNotMatch(rawText, /INTERNAL_ANALYSIS|DECISION_STATUS|EVIDENCE_USED/);
});
