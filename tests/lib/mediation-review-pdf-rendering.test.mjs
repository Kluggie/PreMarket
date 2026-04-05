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

test('pre-send web-parity PDF uses memo-style proposer-only framing without recommendation or confidence labels', async () => {
  const stored = buildStoredV2Evaluation({
    ok: true,
    data: {
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary:
        'The draft is suitable for early vendor discussion, but it is not yet strong enough for a reliable fixed-price pilot commitment.',
      missing_information: [
        'What is included in the initial fixed-price pilot scope?',
        'What acceptance criteria trigger final approval?',
      ],
      ambiguous_terms: ['Phase-two pricing remains implied rather than stated.'],
      likely_recipient_questions: ['Who owns data cleanup before implementation starts?'],
      likely_pushback_areas: ['A vendor may resist fixed-price responsibility while scope and remediation remain open.'],
      commercial_risks: ['Pricing posture assumes fixed-price certainty before the change process is defined.'],
      implementation_risks: ['Documentation quality and remediation ownership remain unclear.'],
      suggested_clarifications: ['Define scope, acceptance, and remediation ownership before sending.'],
    },
    model: 'gemini-2.5-pro',
    generation_model: 'gemini-2.5-pro',
  });
  const sections = [
    {
      heading: 'Review Scope',
      paragraphs: [
        'This Pre-send Review is based only on the sender’s materials. It does not assess recipient alignment or agreement likelihood.',
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
    title: 'Pre-send Review',
    subtitle: 'Opportunity',
    comparisonId: 'cmp_presend_pdf',
    metrics: [
      { label: 'Readiness to Send', value: 'Ready with Clarifications' },
      { label: 'Review Type', value: 'Pre-send Review' },
      { label: 'Scope', value: 'Sender-side only' },
      { label: 'Points to Tighten', value: '4 items' },
    ],
    timelineItems: [
      { label: 'Opportunity Created', value: 'Apr 4, 2026' },
      { label: 'Last Updated', value: 'Apr 4, 2026' },
    ],
    sections,
  });

  const rawText = await extractPdfText(buffer);
  assert.match(rawText, /Pre-send Review/);
  assert.match(rawText, /READINESS TO SEND/);
  assert.match(rawText, /REVIEW TYPE/);
  assert.match(rawText, /SCOPE/);
  assert.match(rawText, /READINESS SUMMARY/);
  assert.match(rawText, /MAIN GAPS BEFORE SHARING/);
  assert.match(rawText, /LIKELY VENDOR PUSHBACK/);
  assert.match(rawText, /COMMERCIAL AND DELIVERY RISKS/);
  assert.doesNotMatch(rawText, /RECOMMENDATION/);
  assert.doesNotMatch(rawText, /CONFIDENCE/);
  assert.doesNotMatch(rawText, /MISSING INFORMATION/);
});
