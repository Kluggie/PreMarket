import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderWebParityPdfBuffer } from '../../server/routes/document-comparisons/_pdf.ts';
import { getPresentationSections } from '../../src/lib/aiReportUtils.js';

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

test('pre-send web-parity PDF can render unilateral readiness metrics without mediation labels', async () => {
  const sections = [
    {
      heading: 'Review Scope',
      paragraphs: [
        'This Pre-send Review is based only on the sender’s materials. It does not assess recipient alignment or agreement likelihood.',
      ],
    },
    {
      heading: 'Readiness to Send',
      paragraphs: [
        'The draft is close to ready, but scope boundaries and acceptance ownership still need clarification before sharing.',
      ],
    },
    {
      heading: 'Likely Recipient Questions',
      bullets: [
        'Who owns data cleanup before implementation starts?',
        'What acceptance criteria trigger final approval?',
      ],
      numberedBullets: true,
    },
  ];

  const buffer = await renderWebParityPdfBuffer({
    title: 'Pre-send Review',
    subtitle: 'Opportunity',
    comparisonId: 'cmp_presend_pdf',
    metrics: [
      { label: 'Readiness', value: 'Ready with Clarifications' },
      { label: 'Missing Information', value: '2 items' },
      { label: 'Likely Recipient Questions', value: '2 items' },
      { label: 'Suggested Clarifications', value: '3 items' },
    ],
    timelineItems: [
      { label: 'Opportunity Created', value: 'Apr 4, 2026' },
      { label: 'Last Updated', value: 'Apr 4, 2026' },
    ],
    sections,
  });

  const rawText = await extractPdfText(buffer);
  assert.match(rawText, /Pre-send Review/);
  assert.match(rawText, /READINESS/);
  assert.match(rawText, /LIKELY RECIPIENT QUESTIONS/);
  assert.doesNotMatch(rawText, /RECOMMENDATION/);
  assert.doesNotMatch(rawText, /CONFIDENCE/);
});
