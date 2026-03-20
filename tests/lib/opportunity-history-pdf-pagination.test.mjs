import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderOpportunityHistoryPdfBuffer } from '../../server/routes/document-comparisons/_pdf.ts';

function normalizeExtractedPdfText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return {
      text: normalizeExtractedPdfText(parsed?.text || ''),
      pageCount: Array.isArray(parsed?.pages)
        ? parsed.pages.length
        : Number(parsed?.total || 0),
    };
  } finally {
    await parser.destroy();
  }
}

test('opportunity PDF preserves Round 1 content when it spans multiple pages', async () => {
  const longRoundBody = Array.from(
    { length: 2200 },
    (_, index) => `ROUND1_SEGMENT_${index}_RECIPIENT_SAFE_CONTEXT`,
  ).join(' ');
  const tailMarker = 'ROUND_ONE_TAIL_MARKER_KEEP_ME';
  const criticalHeading = '3. Solution Description: This line must survive pagination boundaries.';
  const roundTwoMarker = 'ROUND_TWO_START_MARKER_VISIBLE';

  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'Pagination Regression Opportunity',
    comparisonId: 'cmp_pagination_regression',
    historyHeading: 'Shared History',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        authorLabel: 'Proposer',
        sourceLabel: 'typed',
        timestampLabel: 'Mar 20, 2026 10:45 PM',
        html: `
          <h2>Round 1 Submission</h2>
          <p>${longRoundBody}</p>
          <p>${criticalHeading}</p>
          <p>${tailMarker}</p>
        `,
      },
      {
        roundLabel: 'Round 2 — Shared by Recipient',
        authorLabel: 'Recipient',
        sourceLabel: 'typed',
        timestampLabel: 'Mar 20, 2026 10:47 PM',
        html: `<p>${roundTwoMarker}</p>`,
      },
    ],
  });

  const { text, pageCount } = await extractPdfText(buffer);
  assert.ok(pageCount >= 2, `Expected multi-page PDF, got ${pageCount} page(s)`);

  const criticalHeadingIndex = text.indexOf('3. Solution Description');
  const tailMarkerIndex = text.indexOf(tailMarker);
  const roundTwoMarkerIndex = text.indexOf(roundTwoMarker);

  assert.ok(criticalHeadingIndex >= 0, 'Expected Round 1 critical heading text to be present');
  assert.ok(tailMarkerIndex >= 0, 'Expected Round 1 tail marker to be present');
  assert.ok(roundTwoMarkerIndex >= 0, 'Expected Round 2 marker to be present');
  assert.ok(
    tailMarkerIndex < roundTwoMarkerIndex,
    'Round 2 content rendered before Round 1 finished; expected Round 1 completion first',
  );
});

test('opportunity PDF keeps all rounds in order after a multi-page first round', async () => {
  const longRoundBody = Array.from(
    { length: 1600 },
    (_, index) => `ROUND1_ORDER_SEGMENT_${index}`,
  ).join(' ');
  const markers = [
    'ROUND_ONE_FINAL_MARKER',
    'ROUND_TWO_FINAL_MARKER',
    'ROUND_THREE_FINAL_MARKER',
  ];

  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'Shared History Ordering Regression',
    comparisonId: 'cmp_order_regression',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        html: `<p>${longRoundBody}</p><p>${markers[0]}</p>`,
      },
      {
        roundLabel: 'Round 2 — Shared by Recipient',
        html: `<p>${markers[1]}</p>`,
      },
      {
        roundLabel: 'Round 3 — Shared by Proposer',
        html: `<p>${markers[2]}</p>`,
      },
    ],
  });

  const { text } = await extractPdfText(buffer);
  const firstIndex = text.indexOf(markers[0]);
  const secondIndex = text.indexOf(markers[1]);
  const thirdIndex = text.indexOf(markers[2]);

  assert.ok(firstIndex >= 0, 'Expected Round 1 marker to be present');
  assert.ok(secondIndex >= 0, 'Expected Round 2 marker to be present');
  assert.ok(thirdIndex >= 0, 'Expected Round 3 marker to be present');
  assert.ok(firstIndex < secondIndex && secondIndex < thirdIndex, 'Round ordering markers are out of sequence');
});
