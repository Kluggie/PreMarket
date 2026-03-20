import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderOpportunityHistoryPdfBuffer } from '../../server/routes/document-comparisons/_pdf.ts';

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return {
      rawText: String(parsed?.text || ''),
      pageCount: Array.isArray(parsed?.pages)
        ? parsed.pages.length
        : Number(parsed?.total || 0),
    };
  } finally {
    await parser.destroy();
  }
}

test('opportunity PDF uses the light-blue header fill path', async () => {
  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'Header Color Verification',
    comparisonId: 'cmp_header_color',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        text: 'Recipient-safe content',
      },
    ],
  });

  const stream = buffer.toString('latin1');
  assert.match(
    stream,
    /0\.86 0\.92 1\. rg[\s\S]{0,140}-96\. re[\s\S]{0,20}\nf/,
    'Expected light-blue header rectangle fill to be written into the PDF stream',
  );
});

test('opportunity PDF prefers html over plain text and keeps list/line-break structure', async () => {
  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'HTML Preference Verification',
    comparisonId: 'cmp_html_priority',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        html: `
          <p>HTML_ONLY_MARKER</p>
          <p>Line A<br/>Line B</p>
          <ul>
            <li>UL item one</li>
            <li>UL item two</li>
          </ul>
          <ol>
            <li>OL item one</li>
            <li>OL item two</li>
          </ol>
        `,
        text: 'TEXT_FALLBACK_ONLY_MARKER',
      },
    ],
  });

  const { rawText } = await extractPdfText(buffer);
  assert.ok(rawText.includes('HTML_ONLY_MARKER'), 'Expected html marker content in PDF output');
  assert.ok(!rawText.includes('TEXT_FALLBACK_ONLY_MARKER'), 'Expected html to win over plain-text fallback');
  assert.match(rawText, /Line A\s+Line B/, 'Expected line-break content to be preserved');
  assert.match(rawText, /UL item one/, 'Expected unordered list item to render');
  assert.match(rawText, /UL item two/, 'Expected unordered list item to render');
  assert.match(rawText, /1\.\s*OL item one/, 'Expected ordered list numbering to render');
  assert.match(rawText, /2\.\s*OL item two/, 'Expected ordered list numbering to render');
});

test('opportunity PDF emits bold, italic, and underline drawing commands for rich text marks', async () => {
  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'Style Verification',
    comparisonId: 'cmp_style_marks',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        html: '<p><strong>BOLD_MARK</strong> and <em>ITALIC_MARK</em> and <u>UNDERLINE_MARK</u></p>',
      },
    ],
  });

  const stream = buffer.toString('latin1');
  assert.ok(stream.includes('/Helvetica-Bold'), 'Expected bold font to be present in PDF stream');
  assert.ok(
    stream.includes('/Helvetica-Oblique') || stream.includes('/Helvetica-BoldOblique'),
    'Expected italic font to be present in PDF stream',
  );
  assert.match(
    stream,
    /\(UNDERLINE_MARK\) Tj[\s\S]{0,220}\n0\.5 w\s*\n[0-9.]+ [0-9.]+ m\s*\n[0-9.]+ [0-9.]+ l\s*\nS/,
    'Expected underline path stroke near underlined marker text',
  );
});

test('opportunity PDF paginates long rich content without clipping and preserves round ordering', async () => {
  const longRichBody = Array.from(
    { length: 2400 },
    (_, index) => `<strong>SEG_${index}</strong> recipient-safe narrative`,
  ).join(' ');
  const roundOneTail = 'ROUND_ONE_TAIL_MARKER_KEEP_ME';
  const roundTwoMarker = 'ROUND_TWO_MARKER_VISIBLE';

  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'Pagination Rich Verification',
    comparisonId: 'cmp_rich_pagination',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        html: `
          <h2>Round 1 Heading</h2>
          <p>${longRichBody}</p>
          <ul><li>Round 1 list item one</li><li>Round 1 list item two</li></ul>
          <p>${roundOneTail}</p>
        `,
      },
      {
        roundLabel: 'Round 2 — Shared by Recipient',
        html: `<p>${roundTwoMarker}</p>`,
      },
    ],
  });

  const { rawText, pageCount } = await extractPdfText(buffer);
  assert.ok(pageCount >= 2, `Expected multi-page output, got ${pageCount} page(s)`);

  const tailIndex = rawText.indexOf(roundOneTail);
  const roundTwoIndex = rawText.indexOf(roundTwoMarker);
  assert.ok(tailIndex >= 0, 'Expected Round 1 tail marker to be present');
  assert.ok(roundTwoIndex >= 0, 'Expected Round 2 marker to be present');
  assert.ok(tailIndex < roundTwoIndex, 'Round 2 appeared before Round 1 completed');
});

test('opportunity PDF renderOpportunityHistoryPdfBuffer still produces a light-blue header even when html content is empty (text-only fallback path)', async () => {
  // Simulates the retry path used in both download handlers when the primary
  // render throws: entries are retried with html='' so jsdom is not needed, but
  // the light-blue header must still be present.
  const buffer = await renderOpportunityHistoryPdfBuffer({
    title: 'Text-Only Fallback Verification',
    comparisonId: 'cmp_text_only_fallback',
    entries: [
      {
        roundLabel: 'Round 1 — Shared by Proposer',
        html: '',
        text: 'Plain text content only, no HTML.',
      },
    ],
  });

  const stream = buffer.toString('latin1');
  // Must use the light-blue header (219/255≈0.86, 234/255≈0.92, 254/255≈1.0)
  assert.match(
    stream,
    /0\.86 0\.92 1\. rg[\s\S]{0,140}-96\. re[\s\S]{0,20}\nf/,
    'Text-only fallback must still produce a light-blue header rectangle',
  );
  // Must NOT use the dark-navy slate-900 header colour from renderProfessionalPdfBuffer
  assert.ok(
    !stream.includes('0.059 0.090 0.165 rg'),
    'Dark-navy header colour must not appear in the Opportunity PDF output',
  );
});
