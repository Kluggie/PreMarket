import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderWebParityPdfBuffer } from '../../server/routes/document-comparisons/_pdf.ts';
import { getPresentationSections } from '../../src/lib/aiReportUtils.js';
import { buildStoredV2Evaluation } from '../../server/routes/document-comparisons/_helpers.ts';

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
      other_side_needed: ['The responding side should confirm ownership of cleanup and any scope corrections that affect the pilot boundary.'],
      discussion_starting_points: ['Confirm the pilot scope boundary, measurable outcomes, and ownership of cleanup work.'],
      intake_status: 'awaiting_other_side_input',
      basis_note:
        'Based only on the currently submitted materials. A fuller bilateral mediation analysis becomes possible once the other side responds.',
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });
  const sections = [
    {
      heading: 'Shared Intake Scope',
      paragraphs: [
        'Based only on the currently submitted materials. A fuller bilateral mediation analysis becomes possible once the other side responds.',
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
    title: 'Shared Intake Summary',
    subtitle: 'Opportunity',
    comparisonId: 'cmp_presend_pdf',
    metrics: [
      { label: 'Status', value: 'Awaiting other side input' },
      { label: 'Review Type', value: 'Shared Intake Summary' },
      { label: 'Input Basis', value: 'One side\'s materials' },
      { label: 'Open Questions', value: '2 items' },
    ],
    timelineItems: [
      { label: 'Opportunity Created', value: 'Apr 4, 2026' },
      { label: 'Last Updated', value: 'Apr 4, 2026' },
    ],
    sections,
  });

  const rawText = await extractPdfText(buffer);
  assert.match(rawText, /Shared Intake Summary/);
  assert.match(rawText, /STATUS/);
  assert.match(rawText, /REVIEW TYPE/);
  assert.match(rawText, /INPUT BASIS/);
  assert.match(rawText, /SUBMISSION SUMMARY/);
  assert.match(rawText, /SCOPE SNAPSHOT/);
  assert.match(rawText, /OPEN QUESTIONS/);
  assert.match(rawText, /SUGGESTED CLARIFICATIONS/);
  assert.match(rawText, /DISCUSSION STARTING POINTS/);
  assert.match(rawText, /INTAKE STATUS/);
  assert.match(rawText, /Awaiting other side input/);
  assert.match(rawText, /Based only on the currently submitted materials/);
  assert.doesNotMatch(rawText, /READINESS/);
  assert.doesNotMatch(rawText, /RECOMMENDATION/);
  assert.doesNotMatch(rawText, /CONFIDENCE/);
  assert.doesNotMatch(rawText, /LIKELY RESPONSE FROM THE OTHER SIDE|RESIDUAL RISKS AND POINTS TO TIGHTEN/i);
  assert.doesNotMatch(rawText, /\bPre-send Review\b|\bInitial Review\b|\bsender-side\b|\bbefore sending\b/i);
});
