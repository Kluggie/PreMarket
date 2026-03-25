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
