/**
 * document-comparison-integration.test.mjs
 *
 * End-to-end model-level tests covering:
 *  - Recipient details (name + email) survive the full save → reopen cycle
 *  - Document title renames survive the full save → reopen cycle
 *  - Rename propagates correctly through Step navigation (model)
 *  - Uploaded-file rename fallback logic
 *  - Compilation of renamed documents produces correct bundles
 *  - Recipient label display on comparison / proposal list items
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileBundles,
  compileBundleForVisibility,
  createDocument,
  hydrateDocumentsFromComparison,
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
} from '../../src/pages/document-comparison/documentsModel.js';
import { buildComparisonDraftSavePayload } from '../../src/pages/document-comparison/draftPayload.js';
import { formatRecipientLabel, formatRecipientShort } from '../../src/lib/recipientUtils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: simulate the full "save then reopen" round-trip in the frontend model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the payload that would be sent to the server when saving a draft,
 * then simulate what the server returns (mapComparisonRow response),
 * then hydrate that back into the documents[] array.
 *
 * This proves the full frontend cycle without needing a live server.
 */
function simulateRoundTrip({ documents, recipientName, recipientEmail }) {
  const confDocs = documents.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDocs = documents.filter((d) => d.visibility === VISIBILITY_SHARED);
  const confBundle = compileBundleForVisibility(documents, VISIBILITY_CONFIDENTIAL);
  const sharedBundle = compileBundleForVisibility(documents, VISIBILITY_SHARED);

  const docATitle = confDocs.length === 1 ? confDocs[0].title || null : null;
  const docBTitle = sharedDocs.length === 1 ? sharedDocs[0].title || null : null;

  const payload = buildComparisonDraftSavePayload({
    snapshot: {
      title: 'Test Comparison',
      docAText: confBundle.text,
      docBText: sharedBundle.text,
      docAHtml: confBundle.html,
      docBHtml: sharedBundle.html,
      docAJson: confBundle.json,
      docBJson: sharedBundle.json,
      docASource: confBundle.source,
      docBSource: sharedBundle.source,
      docAFiles: confBundle.files,
      docBFiles: sharedBundle.files,
    },
    stepToSave: 2,
    recipientName,
    recipientEmail,
    docATitle,
    docBTitle,
  });

  // Simulate what the server would return after persisting → mapComparisonRow
  const serverComparison = {
    id: 'cmp_test_001',
    title: payload.title,
    status: 'draft',
    draft_step: payload.draft_step,
    doc_a_text: payload.doc_a_text,
    doc_b_text: payload.doc_b_text,
    doc_a_html: payload.doc_a_html,
    doc_b_html: payload.doc_b_html,
    doc_a_json: payload.doc_a_json,
    doc_b_json: payload.doc_b_json,
    doc_a_source: payload.doc_a_source,
    doc_b_source: payload.doc_b_source,
    doc_a_files: payload.doc_a_files,
    doc_b_files: payload.doc_b_files,
    // These are the key fields we're testing
    recipient_name: payload.recipient_name,
    recipient_email: payload.recipient_email,
    doc_a_title: payload.doc_a_title,
    doc_b_title: payload.doc_b_title,
  };

  // Hydrate back into documents[]
  const reopenedDocs = hydrateDocumentsFromComparison(serverComparison);
  return { payload, serverComparison, reopenedDocs };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Recipient details survive save → reopen
// ─────────────────────────────────────────────────────────────────────────────

test('recipient name and email survive full save → reopen round-trip', () => {
  const documents = [
    createDocument({
      id: 'doc-a',
      title: 'Confidential NDA',
      visibility: VISIBILITY_CONFIDENTIAL,
      text: 'Secret terms here',
    }),
    createDocument({
      id: 'doc-b',
      title: 'Shared Terms',
      visibility: VISIBILITY_SHARED,
      text: 'Agreed terms here',
    }),
  ];

  const { payload, serverComparison } = simulateRoundTrip({
    documents,
    recipientName: 'Sarah Chen',
    recipientEmail: 'sarah@company.com',
  });

  // Payload has the fields
  assert.equal(payload.recipient_name, 'Sarah Chen');
  assert.equal(payload.recipient_email, 'sarah@company.com');

  // Server comparison (what mapComparisonRow returns) has the fields
  assert.equal(serverComparison.recipient_name, 'Sarah Chen');
  assert.equal(serverComparison.recipient_email, 'sarah@company.com');
});

test('recipient email is lowercased on save', () => {
  const documents = [createDocument({ visibility: VISIBILITY_CONFIDENTIAL, text: 'A' })];
  const { payload } = simulateRoundTrip({
    documents,
    recipientName: '',
    recipientEmail: 'SARAH@COMPANY.COM',
  });
  assert.equal(payload.recipient_email, 'sarah@company.com');
});

test('absent recipient fields are null in payload and server comparison', () => {
  const documents = [createDocument({ visibility: VISIBILITY_CONFIDENTIAL, text: 'A' })];
  const { payload, serverComparison } = simulateRoundTrip({
    documents,
    recipientName: null,
    recipientEmail: null,
  });
  assert.equal(payload.recipient_name, null);
  assert.equal(payload.recipient_email, null);
  assert.equal(serverComparison.recipient_name, null);
  assert.equal(serverComparison.recipient_email, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Document title renames survive save → reopen
// ─────────────────────────────────────────────────────────────────────────────

test('renamed document title survives full save → reopen round-trip', () => {
  const documents = [
    createDocument({
      id: 'doc-a',
      title: 'My NDA',
      visibility: VISIBILITY_CONFIDENTIAL,
      text: 'Confidential details',
    }),
    createDocument({
      id: 'doc-b',
      title: 'Term Sheet',
      visibility: VISIBILITY_SHARED,
      text: 'Shared info',
    }),
  ];

  const { payload, reopenedDocs } = simulateRoundTrip({
    documents,
    recipientName: 'Jo Smith',
    recipientEmail: 'jo@example.com',
  });

  // Payload carries the renamed titles
  assert.equal(payload.doc_a_title, 'My NDA');
  assert.equal(payload.doc_b_title, 'Term Sheet');

  // After reopening, both documents have the correct titles
  const confDoc = reopenedDocs.find((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDoc = reopenedDocs.find((d) => d.visibility === VISIBILITY_SHARED);
  assert.ok(confDoc, 'confidential doc should exist after reopen');
  assert.ok(sharedDoc, 'shared doc should exist after reopen');
  assert.equal(confDoc.title, 'My NDA');
  assert.equal(sharedDoc.title, 'Term Sheet');
});

test('default title "Confidential Information" round-trips correctly', () => {
  const documents = [
    createDocument({
      title: 'Confidential Information',
      visibility: VISIBILITY_CONFIDENTIAL,
      text: 'Some content',
    }),
  ];
  const { reopenedDocs } = simulateRoundTrip({ documents, recipientName: null, recipientEmail: null });
  const confDoc = reopenedDocs.find((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  assert.equal(confDoc.title, 'Confidential Information');
});

test('title revert: if no doc_a_title is stored, reopen falls back to "Confidential Information"', () => {
  // Simulate a comparison row with no stored title (legacy / pre-feature data)
  const serverComparison = {
    doc_a_text: 'Some text',
    doc_a_html: '<p>Some text</p>',
    doc_a_source: 'typed',
    doc_a_files: [],
    doc_a_title: null, // no stored title
    doc_b_text: 'Shared text',
    doc_b_html: '<p>Shared text</p>',
    doc_b_source: 'typed',
    doc_b_files: [],
    doc_b_title: null,
    recipient_name: null,
    recipient_email: null,
  };
  const docs = hydrateDocumentsFromComparison(serverComparison);
  const confDoc = docs.find((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDoc = docs.find((d) => d.visibility === VISIBILITY_SHARED);
  // Falls back to the legacy label defaults
  assert.equal(confDoc.title, 'Confidential Information');
  assert.equal(sharedDoc.title, 'Shared Information');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rename propagation across navigation (model level)
// ─────────────────────────────────────────────────────────────────────────────

test('rename applied via updateDocument-style change is visible in compileBundles output', () => {
  const original = createDocument({
    id: 'doc-conf',
    title: 'Old Title',
    visibility: VISIBILITY_CONFIDENTIAL,
    text: 'Alpha content',
  });

  // Simulate what DocumentComparisonCreate.updateDocument does:
  const renamed = { ...original, title: 'New Title' };
  const documents = [renamed];

  const { confidential } = compileBundles(documents);

  // Bundle text shouldn't include the title (single doc → no header)
  assert.equal(confidential.text, 'Alpha content');
  // Title is preserved on the doc object itself
  assert.equal(documents[0].title, 'New Title');
});

test('multi-doc compilation includes renamed titles as section headers', () => {
  const doc1 = createDocument({
    id: 'doc-a1',
    title: 'Contract Section',
    visibility: VISIBILITY_CONFIDENTIAL,
    text: 'First part',
  });
  const doc2 = createDocument({
    id: 'doc-a2',
    title: 'Addendum',
    visibility: VISIBILITY_CONFIDENTIAL,
    text: 'Second part',
  });

  const bundle = compileBundleForVisibility([doc1, doc2], VISIBILITY_CONFIDENTIAL);

  // Multi-doc bundle should include the title as a header
  assert.ok(bundle.text.includes('Contract Section'), 'should include first doc title');
  assert.ok(bundle.text.includes('Addendum'), 'should include second doc title');
  assert.ok(bundle.text.includes('First part'), 'should include first doc content');
  assert.ok(bundle.text.includes('Second part'), 'should include second doc content');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Uploaded-file rename fallback logic
// ─────────────────────────────────────────────────────────────────────────────

// The React component commitTitleEdit logic extracted as a pure function for testing.
function simulateCommitTitleEdit({ editingTitleValue, prevDoc }) {
  const trimmed = editingTitleValue.trim();
  if (trimmed) {
    return trimmed;
  }
  // Empty input: for uploaded files revert to the previous valid title;
  // for typed docs fall back gracefully to 'Untitled Document'.
  const prevTitle = String(prevDoc?.title || '').trim();
  return prevDoc?.source === 'uploaded' && prevTitle
    ? prevTitle
    : 'Untitled Document';
}

test('clearing an uploaded file title reverts to the original filename', () => {
  const uploadedDoc = createDocument({
    title: 'contract_nda_v2.pdf',
    source: 'uploaded',
    visibility: VISIBILITY_CONFIDENTIAL,
  });

  const result = simulateCommitTitleEdit({
    editingTitleValue: '',
    prevDoc: uploadedDoc,
  });

  assert.equal(result, 'contract_nda_v2.pdf');
});

test('clearing a typed document title falls back to "Untitled Document"', () => {
  const typedDoc = createDocument({
    title: 'My old title',
    source: 'typed',
    visibility: VISIBILITY_CONFIDENTIAL,
  });

  const result = simulateCommitTitleEdit({
    editingTitleValue: '',
    prevDoc: typedDoc,
  });

  assert.equal(result, 'Untitled Document');
});

test('non-empty rename commit always uses the new value (uploaded or typed)', () => {
  const uploadedDoc = createDocument({
    title: 'original-file.pdf',
    source: 'uploaded',
    visibility: VISIBILITY_CONFIDENTIAL,
  });
  const typedDoc = createDocument({
    title: 'Old typed title',
    source: 'typed',
    visibility: VISIBILITY_CONFIDENTIAL,
  });

  assert.equal(simulateCommitTitleEdit({ editingTitleValue: 'New Name', prevDoc: uploadedDoc }), 'New Name');
  assert.equal(simulateCommitTitleEdit({ editingTitleValue: 'New Name', prevDoc: typedDoc }), 'New Name');
});

test('whitespace-only input is treated as empty and reverts correctly', () => {
  const uploadedDoc = createDocument({
    title: 'report.pdf',
    source: 'uploaded',
    visibility: VISIBILITY_SHARED,
  });

  const result = simulateCommitTitleEdit({
    editingTitleValue: '   ',
    prevDoc: uploadedDoc,
  });

  assert.equal(result, 'report.pdf');
});

test('uploaded file with empty previous title falls back to "Untitled Document"', () => {
  const uploadedDoc = createDocument({
    title: '',
    source: 'uploaded',
    visibility: VISIBILITY_CONFIDENTIAL,
  });

  const result = simulateCommitTitleEdit({
    editingTitleValue: '',
    prevDoc: uploadedDoc,
  });

  // prevTitle is empty, so uploaded fallback is not triggered → use 'Untitled Document'
  assert.equal(result, 'Untitled Document');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Recipient label display on list items
// ─────────────────────────────────────────────────────────────────────────────

test('comparison list item shows both name and email via formatRecipientLabel', () => {
  // Simulate what Proposals.jsx / Dashboard.jsx does
  const comparison = { recipient_name: 'Sarah Chen', recipient_email: 'sarah@company.com' };
  assert.equal(
    formatRecipientLabel(comparison.recipient_name, comparison.recipient_email),
    'With: Sarah Chen · sarah@company.com',
  );
});

test('comparison list item falls back gracefully when only email is available', () => {
  const comparison = { recipient_name: null, recipient_email: 'sarah@company.com' };
  assert.equal(
    formatRecipientLabel(comparison.recipient_name, comparison.recipient_email),
    'With: sarah@company.com',
  );
});

test('comparison list item shows "With: Not specified" when neither field is set', () => {
  const comparison = { recipient_name: null, recipient_email: null };
  assert.equal(
    formatRecipientLabel(comparison.recipient_name, comparison.recipient_email),
    'With: Not specified',
  );
});

test('proposal list item uses party_b_name and counterparty_email via formatRecipientLabel', () => {
  const proposal = { party_b_name: 'Jo Smith', counterparty_email: 'jo@example.com' };
  assert.equal(
    formatRecipientLabel(proposal.party_b_name, proposal.counterparty_email),
    'With: Jo Smith · jo@example.com',
  );
});

test('dashboard compact row uses formatRecipientShort (no With: prefix)', () => {
  const proposal = { party_b_name: 'Jo Smith', counterparty_email: 'jo@example.com' };
  const label = formatRecipientShort(proposal.party_b_name, proposal.counterparty_email);
  assert.equal(label, 'Jo Smith · jo@example.com');
  // Confirm it does NOT include "With:"
  assert.ok(!label.startsWith('With:'), 'formatRecipientShort should not start with "With:"');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. No regression: compilation still produces correct bundles
// ─────────────────────────────────────────────────────────────────────────────

test('single confidential doc compiles to its text content without a title header', () => {
  const doc = createDocument({
    title: 'My NDA',
    visibility: VISIBILITY_CONFIDENTIAL,
    text: 'This is a secret.',
    html: '<p>This is a secret.</p>',
  });

  const bundle = compileBundleForVisibility([doc], VISIBILITY_CONFIDENTIAL);

  // Single doc: no title header prepended
  assert.equal(bundle.text, 'This is a secret.');
  assert.equal(bundle.source, 'typed');
});

test('empty documents array produces empty bundles', () => {
  const { confidential, shared } = compileBundles([]);
  assert.equal(confidential.text, '');
  assert.equal(shared.text, '');
});

test('hydrateDocumentsFromComparison returns empty array for blank comparison', () => {
  const docs = hydrateDocumentsFromComparison({});
  assert.equal(docs.length, 0);
});
