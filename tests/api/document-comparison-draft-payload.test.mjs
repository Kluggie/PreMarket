import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComparisonDraftSavePayload } from '../../src/pages/document-comparison/draftPayload.js';

test('draft payload builder includes both editor values and required step2 keys', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: {
      title: 'Step 2 Save',
      docAText: 'Unique confidential editor text',
      docBText: 'Unique shared editor text',
      docAHtml: '<p>Unique confidential editor text</p>',
      docBHtml: '<p>Unique shared editor text</p>',
      docAJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      docBJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      docASource: 'typed',
      docBSource: 'typed',
      docAFiles: [],
      docBFiles: [],
    },
    stepToSave: 2,
    linkedProposalId: 'proposal_123',
    routeProposalId: '',
    token: '',
    docASpans: [{ start: 1, end: 10, level: 'confidential' }],
    docBSpans: [{ start: 2, end: 9, level: 'shared' }],
    metadata: { origin: 'step2' },
  });

  assert.equal(payload.title, 'Step 2 Save');
  assert.equal(payload.doc_a_text, 'Unique confidential editor text');
  assert.equal(payload.doc_b_text, 'Unique shared editor text');
  assert.equal(payload.draft_step, 2);
  assert.equal(payload.proposalId, 'proposal_123');
  assert.equal(Array.isArray(payload.doc_a_spans), true);
  assert.equal(Array.isArray(payload.doc_b_spans), true);
  assert.equal(payload.metadata.origin, 'step2');
  assert.equal(typeof payload.doc_a_html, 'string');
  assert.equal(typeof payload.doc_b_html, 'string');
});
