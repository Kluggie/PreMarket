/**
 * document-comparison-session-persistence.test.mjs
 *
 * Tests for the canonical documents_session persistence model.
 * Verifies that saving and reopening a draft preserves:
 *   - Exact number of documents (not collapsed to 2)
 *   - Per-document titles
 *   - Per-document visibility/side assignment
 *   - Stable document ids
 *   - Source type and uploaded filenames
 *   - Ordering
 *   - Top-level comparison title
 *   - Legacy fallback (comparisons without documents_session)
 *   - Evaluation compatibility (compiled bundles still produced)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileBundles,
  compileBundleForVisibility,
  createDocument,
  hydrateDocumentsFromComparison,
  serializeDocumentsSession,
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
  VISIBILITY_UNCLASSIFIED,
} from '../../src/pages/document-comparison/documentsModel.js';
import { buildComparisonDraftSavePayload } from '../../src/pages/document-comparison/draftPayload.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: simulate the full save → server → reopen round-trip
// ─────────────────────────────────────────────────────────────────────────────

function simulateFullRoundTrip({ documents, title = 'Test Comparison', recipientName = null, recipientEmail = null }) {
  const confDocs = documents.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDocs = documents.filter((d) => d.visibility === VISIBILITY_SHARED);
  const confBundle = compileBundleForVisibility(documents, VISIBILITY_CONFIDENTIAL);
  const sharedBundle = compileBundleForVisibility(documents, VISIBILITY_SHARED);

  const docATitle = confDocs.length === 1 ? confDocs[0].title || null : null;
  const docBTitle = sharedDocs.length === 1 ? sharedDocs[0].title || null : null;

  const payload = buildComparisonDraftSavePayload({
    snapshot: {
      title,
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
    documentsSession: serializeDocumentsSession(documents),
  });

  // Simulate what the server would return via mapComparisonRow
  const serverComparison = {
    id: 'cmp_test_session_001',
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
    doc_a_title: payload.doc_a_title,
    doc_b_title: payload.doc_b_title,
    recipient_name: payload.recipient_name,
    recipient_email: payload.recipient_email,
    // Canonical documents session — persisted in inputs JSONB
    documents_session: payload.documents_session,
  };

  // Hydrate back into documents[]
  const reopenedDocs = hydrateDocumentsFromComparison(serverComparison);
  return { payload, serverComparison, reopenedDocs, confBundle, sharedBundle };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Multi-document sessions survive save → reopen
// ─────────────────────────────────────────────────────────────────────────────

test('multi-doc: save 3 confidential + 2 shared docs → reopen restores exact same count', () => {
  const documents = [
    createDocument({ id: 'c1', title: 'NDA', visibility: VISIBILITY_CONFIDENTIAL, text: 'Secret 1' }),
    createDocument({ id: 'c2', title: 'Patent Docs', visibility: VISIBILITY_CONFIDENTIAL, text: 'Secret 2' }),
    createDocument({ id: 'c3', title: 'Financial Terms', visibility: VISIBILITY_CONFIDENTIAL, text: 'Secret 3' }),
    createDocument({ id: 's1', title: 'Proposal Letter', visibility: VISIBILITY_SHARED, text: 'Shared 1' }),
    createDocument({ id: 's2', title: 'Public Terms', visibility: VISIBILITY_SHARED, text: 'Shared 2' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.length, 5, 'should restore all 5 documents');
  assert.equal(
    reopenedDocs.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL).length,
    3,
    'should restore 3 confidential docs',
  );
  assert.equal(
    reopenedDocs.filter((d) => d.visibility === VISIBILITY_SHARED).length,
    2,
    'should restore 2 shared docs',
  );
});

test('multi-doc: per-document titles survive reopen', () => {
  const documents = [
    createDocument({ id: 'a1', title: 'Contract Alpha', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'a2', title: 'Contract Beta', visibility: VISIBILITY_CONFIDENTIAL, text: 'B' }),
    createDocument({ id: 'b1', title: 'Term Sheet', visibility: VISIBILITY_SHARED, text: 'C' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.find((d) => d.id === 'a1').title, 'Contract Alpha');
  assert.equal(reopenedDocs.find((d) => d.id === 'a2').title, 'Contract Beta');
  assert.equal(reopenedDocs.find((d) => d.id === 'b1').title, 'Term Sheet');
});

test('multi-doc: per-document visibility assignment survives reopen', () => {
  const documents = [
    createDocument({ id: 'x1', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'x2', visibility: VISIBILITY_SHARED, text: 'B' }),
    createDocument({ id: 'x3', visibility: VISIBILITY_CONFIDENTIAL, text: 'C' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.find((d) => d.id === 'x1').visibility, VISIBILITY_CONFIDENTIAL);
  assert.equal(reopenedDocs.find((d) => d.id === 'x2').visibility, VISIBILITY_SHARED);
  assert.equal(reopenedDocs.find((d) => d.id === 'x3').visibility, VISIBILITY_CONFIDENTIAL);
});

test('multi-doc: stable document ids survive reopen', () => {
  const documents = [
    createDocument({ id: 'my-stable-id-1', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'my-stable-id-2', visibility: VISIBILITY_SHARED, text: 'B' }),
    createDocument({ id: 'my-stable-id-3', visibility: VISIBILITY_SHARED, text: 'C' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.deepEqual(
    reopenedDocs.map((d) => d.id),
    ['my-stable-id-1', 'my-stable-id-2', 'my-stable-id-3'],
  );
});

test('multi-doc: ordering is preserved on reopen', () => {
  const documents = [
    createDocument({ id: 'first', title: '1st', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'second', title: '2nd', visibility: VISIBILITY_SHARED, text: 'B' }),
    createDocument({ id: 'third', title: '3rd', visibility: VISIBILITY_CONFIDENTIAL, text: 'C' }),
    createDocument({ id: 'fourth', title: '4th', visibility: VISIBILITY_SHARED, text: 'D' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.deepEqual(
    reopenedDocs.map((d) => d.title),
    ['1st', '2nd', '3rd', '4th'],
  );
});

test('multi-doc: uploaded filenames survive reopen', () => {
  const documents = [
    createDocument({
      id: 'up1',
      title: 'contract_nda_v2.pdf',
      visibility: VISIBILITY_CONFIDENTIAL,
      source: 'uploaded',
      text: 'Uploaded content',
      files: [{ name: 'contract_nda_v2.pdf', size: 1024, type: 'application/pdf' }],
    }),
    createDocument({
      id: 'up2',
      title: 'terms.docx',
      visibility: VISIBILITY_SHARED,
      source: 'uploaded',
      text: 'Shared content',
      files: [{ name: 'terms.docx', size: 2048, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
    }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  const up1 = reopenedDocs.find((d) => d.id === 'up1');
  const up2 = reopenedDocs.find((d) => d.id === 'up2');

  assert.equal(up1.title, 'contract_nda_v2.pdf');
  assert.equal(up1.source, 'uploaded');
  assert.equal(up1.files.length, 1);
  assert.equal(up1.files[0].name, 'contract_nda_v2.pdf');

  assert.equal(up2.title, 'terms.docx');
  assert.equal(up2.source, 'uploaded');
  assert.equal(up2.files.length, 1);
  assert.equal(up2.files[0].name, 'terms.docx');
});

test('multi-doc: source type is preserved per document', () => {
  const documents = [
    createDocument({ id: 'd1', source: 'typed', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'd2', source: 'uploaded', visibility: VISIBILITY_CONFIDENTIAL, text: 'B', files: [{ name: 'x.pdf' }] }),
    createDocument({ id: 'd3', source: 'typed', visibility: VISIBILITY_SHARED, text: 'C' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.find((d) => d.id === 'd1').source, 'typed');
  assert.equal(reopenedDocs.find((d) => d.id === 'd2').source, 'uploaded');
  assert.equal(reopenedDocs.find((d) => d.id === 'd3').source, 'typed');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Top-level comparison title survives reopen
// ─────────────────────────────────────────────────────────────────────────────

test('top-level comparison title is stored and returned in payload', () => {
  const documents = [
    createDocument({ visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
  ];

  const { payload } = simulateFullRoundTrip({
    documents,
    title: 'Q1 2026 Contract Review',
  });

  assert.equal(payload.title, 'Q1 2026 Contract Review');
});

test('top-level comparison title round-trips through server comparison', () => {
  const documents = [
    createDocument({ visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
  ];

  const { serverComparison } = simulateFullRoundTrip({
    documents,
    title: 'My Important Review',
  });

  assert.equal(serverComparison.title, 'My Important Review');
});

test('empty title falls back to "Untitled" in payload', () => {
  const documents = [
    createDocument({ visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
  ];

  const { payload } = simulateFullRoundTrip({ documents, title: '' });

  assert.equal(payload.title, 'Untitled');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Legacy fallback (comparisons without documents_session)
// ─────────────────────────────────────────────────────────────────────────────

test('legacy: comparison without documents_session falls back to 2-doc hydration', () => {
  const serverComparison = {
    // No documents_session
    doc_a_text: 'Confidential text',
    doc_a_html: '<p>Confidential text</p>',
    doc_a_source: 'typed',
    doc_a_files: [],
    doc_a_title: 'My NDA',
    doc_b_text: 'Shared text',
    doc_b_html: '<p>Shared text</p>',
    doc_b_source: 'typed',
    doc_b_files: [],
    doc_b_title: 'Shared Terms',
  };

  const docs = hydrateDocumentsFromComparison(serverComparison);

  assert.equal(docs.length, 2);
  assert.equal(docs[0].id, 'legacy-doc-a');
  assert.equal(docs[0].visibility, VISIBILITY_CONFIDENTIAL);
  assert.equal(docs[0].title, 'My NDA');
  assert.equal(docs[0].text, 'Confidential text');
  assert.equal(docs[1].id, 'legacy-doc-b');
  assert.equal(docs[1].visibility, VISIBILITY_SHARED);
  assert.equal(docs[1].title, 'Shared Terms');
});

test('legacy: null documents_session falls back to legacy hydration', () => {
  const serverComparison = {
    documents_session: null,
    doc_a_text: 'X',
    doc_a_html: '<p>X</p>',
    doc_a_source: 'typed',
    doc_a_files: [],
    doc_b_text: 'Y',
    doc_b_html: '<p>Y</p>',
    doc_b_source: 'typed',
    doc_b_files: [],
  };

  const docs = hydrateDocumentsFromComparison(serverComparison);

  assert.equal(docs.length, 2);
  assert.equal(docs[0].id, 'legacy-doc-a');
  assert.equal(docs[1].id, 'legacy-doc-b');
});

test('legacy: empty array documents_session falls back to legacy hydration', () => {
  const serverComparison = {
    documents_session: [],
    doc_a_text: 'Content A',
    doc_a_html: '<p>Content A</p>',
    doc_a_source: 'typed',
    doc_a_files: [],
    doc_b_text: '',
    doc_b_html: '',
    doc_b_source: 'typed',
    doc_b_files: [],
  };

  const docs = hydrateDocumentsFromComparison(serverComparison);

  // Only doc A has content, doc B is blank
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, 'legacy-doc-a');
});

test('legacy: missing doc titles fall back to defaults', () => {
  const serverComparison = {
    doc_a_text: 'A',
    doc_a_html: '<p>A</p>',
    doc_a_source: 'typed',
    doc_a_files: [],
    doc_a_title: null,
    doc_b_text: 'B',
    doc_b_html: '<p>B</p>',
    doc_b_source: 'typed',
    doc_b_files: [],
    doc_b_title: null,
  };

  const docs = hydrateDocumentsFromComparison(serverComparison);

  assert.equal(docs[0].title, 'Confidential Information');
  assert.equal(docs[1].title, 'Shared Information');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Legacy evaluation compatibility (compiled bundles still produced)
// ─────────────────────────────────────────────────────────────────────────────

test('multi-doc: compiled bundles are still produced alongside documents_session', () => {
  const documents = [
    createDocument({ id: 'c1', title: 'NDA Part 1', visibility: VISIBILITY_CONFIDENTIAL, text: 'Secret alpha' }),
    createDocument({ id: 'c2', title: 'NDA Part 2', visibility: VISIBILITY_CONFIDENTIAL, text: 'Secret beta' }),
    createDocument({ id: 's1', title: 'Proposal', visibility: VISIBILITY_SHARED, text: 'Shared content' }),
  ];

  const { payload } = simulateFullRoundTrip({ documents });

  // Compiled bundles should include the content from multi-doc compilation
  assert.ok(payload.doc_a_text.includes('Secret alpha'), 'doc_a_text should have first confidential content');
  assert.ok(payload.doc_a_text.includes('Secret beta'), 'doc_a_text should have second confidential content');
  assert.equal(payload.doc_b_text, 'Shared content', 'doc_b_text should have shared content');

  // documents_session should also be present
  assert.ok(Array.isArray(payload.documents_session), 'documents_session should be in payload');
  assert.equal(payload.documents_session.length, 3, 'documents_session should have all 3 docs');
});

test('multi-doc: compiled bundles have title headers for multi-doc sides', () => {
  const documents = [
    createDocument({ id: 'c1', title: 'Part A', visibility: VISIBILITY_CONFIDENTIAL, text: 'Alpha' }),
    createDocument({ id: 'c2', title: 'Part B', visibility: VISIBILITY_CONFIDENTIAL, text: 'Beta' }),
  ];

  const { confBundle } = simulateFullRoundTrip({ documents });

  assert.ok(confBundle.text.includes('Part A'), 'compiled bundle should have Part A title');
  assert.ok(confBundle.text.includes('Part B'), 'compiled bundle should have Part B title');
  assert.ok(confBundle.text.includes('Alpha'), 'compiled bundle should have Alpha content');
  assert.ok(confBundle.text.includes('Beta'), 'compiled bundle should have Beta content');
});

test('multi-doc: doc_a_title / doc_b_title are null for multi-doc sides', () => {
  const documents = [
    createDocument({ id: 'c1', title: 'NDA 1', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'c2', title: 'NDA 2', visibility: VISIBILITY_CONFIDENTIAL, text: 'B' }),
    createDocument({ id: 's1', title: 'Terms', visibility: VISIBILITY_SHARED, text: 'C' }),
  ];

  const { payload } = simulateFullRoundTrip({ documents });

  // Multi-doc side → doc_a_title is null (can't represent multiple titles in one field)
  assert.equal(payload.doc_a_title, null, 'doc_a_title should be null for multi-doc confidential side');
  // Single-doc side → doc_b_title is preserved
  assert.equal(payload.doc_b_title, 'Terms', 'doc_b_title should be set for single-doc shared side');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. No regression: single-doc-per-side sessions
// ─────────────────────────────────────────────────────────────────────────────

test('single-doc-per-side: round-trip preserves exact structure', () => {
  const documents = [
    createDocument({
      id: 'conf-1',
      title: 'My NDA',
      visibility: VISIBILITY_CONFIDENTIAL,
      text: 'Secret content',
      html: '<p>Secret content</p>',
    }),
    createDocument({
      id: 'shared-1',
      title: 'Term Sheet',
      visibility: VISIBILITY_SHARED,
      text: 'Shared content',
      html: '<p>Shared content</p>',
    }),
  ];

  const { reopenedDocs, payload } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.length, 2);

  // Stable ids preserved
  assert.equal(reopenedDocs[0].id, 'conf-1');
  assert.equal(reopenedDocs[1].id, 'shared-1');

  // Titles preserved
  assert.equal(reopenedDocs[0].title, 'My NDA');
  assert.equal(reopenedDocs[1].title, 'Term Sheet');

  // doc_a_title / doc_b_title also set for single-doc sides
  assert.equal(payload.doc_a_title, 'My NDA');
  assert.equal(payload.doc_b_title, 'Term Sheet');
});

test('single-doc: content round-trips correctly', () => {
  const documents = [
    createDocument({
      visibility: VISIBILITY_CONFIDENTIAL,
      text: 'Confidential text here',
      html: '<p>Confidential text here</p>',
    }),
    createDocument({
      visibility: VISIBILITY_SHARED,
      text: 'Shared text here',
      html: '<p>Shared text here</p>',
    }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.find((d) => d.visibility === VISIBILITY_CONFIDENTIAL).text, 'Confidential text here');
  assert.equal(reopenedDocs.find((d) => d.visibility === VISIBILITY_SHARED).text, 'Shared text here');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Step 2 → save → proposals list → reopen preserves structure
// ─────────────────────────────────────────────────────────────────────────────

test('full workflow: Step 2 multi-doc session → save → reopen preserves all docs', () => {
  // Simulates the full user workflow:
  // 1. User adds 4 documents in Step 1
  // 2. Classifies them as confidential/shared
  // 3. Goes to Step 2, edits content
  // 4. Saves draft
  // 5. Leaves (proposals list)
  // 6. Comes back → reopens draft

  const step2Documents = [
    createDocument({
      id: 'doc-uuid-001',
      title: 'Employment Agreement',
      visibility: VISIBILITY_CONFIDENTIAL,
      source: 'uploaded',
      text: 'Employment terms and conditions...',
      html: '<p>Employment terms and conditions...</p>',
      files: [{ name: 'employment-agreement.pdf', size: 45000 }],
      importStatus: 'imported',
    }),
    createDocument({
      id: 'doc-uuid-002',
      title: 'Salary Details',
      visibility: VISIBILITY_CONFIDENTIAL,
      source: 'typed',
      text: 'Base salary: $150,000\nBonus: 20%',
      html: '<p>Base salary: $150,000</p><p>Bonus: 20%</p>',
    }),
    createDocument({
      id: 'doc-uuid-003',
      title: 'Company Overview',
      visibility: VISIBILITY_SHARED,
      source: 'uploaded',
      text: 'Acme Corp is a leading provider...',
      html: '<p>Acme Corp is a leading provider...</p>',
      files: [{ name: 'company-overview.docx', size: 12000 }],
      importStatus: 'imported',
    }),
    createDocument({
      id: 'doc-uuid-004',
      title: 'Benefits Summary',
      visibility: VISIBILITY_SHARED,
      source: 'typed',
      text: 'Health insurance, 401k, PTO...',
      html: '<p>Health insurance, 401k, PTO...</p>',
    }),
  ];

  const { reopenedDocs, payload } = simulateFullRoundTrip({
    documents: step2Documents,
    title: 'Acme Corp Employment Review',
    recipientName: 'Jane Doe',
    recipientEmail: 'jane@acmecorp.com',
  });

  // Exact same number of documents
  assert.equal(reopenedDocs.length, 4);

  // Each document's identity, title, visibility, source preserved
  const restored1 = reopenedDocs.find((d) => d.id === 'doc-uuid-001');
  assert.ok(restored1, 'doc-uuid-001 should exist');
  assert.equal(restored1.title, 'Employment Agreement');
  assert.equal(restored1.visibility, VISIBILITY_CONFIDENTIAL);
  assert.equal(restored1.source, 'uploaded');
  assert.equal(restored1.files[0].name, 'employment-agreement.pdf');

  const restored2 = reopenedDocs.find((d) => d.id === 'doc-uuid-002');
  assert.ok(restored2, 'doc-uuid-002 should exist');
  assert.equal(restored2.title, 'Salary Details');
  assert.equal(restored2.visibility, VISIBILITY_CONFIDENTIAL);
  assert.equal(restored2.source, 'typed');

  const restored3 = reopenedDocs.find((d) => d.id === 'doc-uuid-003');
  assert.ok(restored3, 'doc-uuid-003 should exist');
  assert.equal(restored3.title, 'Company Overview');
  assert.equal(restored3.visibility, VISIBILITY_SHARED);
  assert.equal(restored3.source, 'uploaded');

  const restored4 = reopenedDocs.find((d) => d.id === 'doc-uuid-004');
  assert.ok(restored4, 'doc-uuid-004 should exist');
  assert.equal(restored4.title, 'Benefits Summary');
  assert.equal(restored4.visibility, VISIBILITY_SHARED);
  assert.equal(restored4.source, 'typed');

  // Compiled bundles still work for evaluation
  assert.ok(payload.doc_a_text.length > 0, 'compiled confidential bundle should have content');
  assert.ok(payload.doc_b_text.length > 0, 'compiled shared bundle should have content');

  // Top-level title
  assert.equal(payload.title, 'Acme Corp Employment Review');

  // Recipient details
  assert.equal(payload.recipient_name, 'Jane Doe');
  assert.equal(payload.recipient_email, 'jane@acmecorp.com');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. serializeDocumentsSession correctness
// ─────────────────────────────────────────────────────────────────────────────

test('serializeDocumentsSession strips _pendingFile and normalizes importStatus', () => {
  const documents = [
    createDocument({
      id: 'test-1',
      title: 'Test',
      visibility: VISIBILITY_CONFIDENTIAL,
      text: 'Content',
      _pendingFile: { name: 'foo.pdf' },
      importStatus: 'importing',
    }),
  ];

  const serialized = serializeDocumentsSession(documents);

  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].id, 'test-1');
  assert.equal(serialized[0].importStatus, 'idle', 'importing should normalize to idle');
  assert.equal(serialized[0]._pendingFile, undefined, '_pendingFile should be stripped');
});

test('serializeDocumentsSession keeps all documents regardless of owner', () => {
  const documents = [
    createDocument({ id: 'r1', owner: 'recipient', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
    createDocument({ id: 'p1', owner: 'proposer', visibility: VISIBILITY_SHARED, text: 'B' }),
  ];

  const serialized = serializeDocumentsSession(documents);

  assert.equal(serialized.length, 2, 'both docs should be serialized');
  assert.equal(serialized[0].id, 'r1');
  assert.equal(serialized[1].id, 'p1');
});

test('serializeDocumentsSession preserves html and json per document', () => {
  const documents = [
    createDocument({
      id: 'd1',
      html: '<p>Test <strong>bold</strong></p>',
      json: { type: 'doc', content: [{ type: 'paragraph' }] },
      visibility: VISIBILITY_CONFIDENTIAL,
    }),
  ];

  const serialized = serializeDocumentsSession(documents);

  assert.equal(serialized[0].html, '<p>Test <strong>bold</strong></p>');
  assert.deepEqual(serialized[0].json, { type: 'doc', content: [{ type: 'paragraph' }] });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. documents_session in payload
// ─────────────────────────────────────────────────────────────────────────────

test('payload includes documents_session when documents are present', () => {
  const documents = [
    createDocument({ visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
  ];

  const { payload } = simulateFullRoundTrip({ documents });

  assert.ok(Array.isArray(payload.documents_session));
  assert.equal(payload.documents_session.length, 1);
});

test('payload documents_session is null when no documents', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'Test' },
    stepToSave: 1,
    documentsSession: [],
  });

  assert.equal(payload.documents_session, null, 'empty array should become null');
});

test('payload documents_session is null when not provided', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'Test' },
    stepToSave: 1,
  });

  assert.equal(payload.documents_session, null, 'undefined/null should become null');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Unclassified documents survive reopen
// ─────────────────────────────────────────────────────────────────────────────

test('documents with unclassified visibility survive reopen', () => {
  const documents = [
    createDocument({ id: 'u1', title: 'Draft Notes', visibility: VISIBILITY_UNCLASSIFIED, text: 'Notes...' }),
    createDocument({ id: 'c1', visibility: VISIBILITY_CONFIDENTIAL, text: 'A' }),
  ];

  const { reopenedDocs } = simulateFullRoundTrip({ documents });

  assert.equal(reopenedDocs.length, 2);
  const unclassified = reopenedDocs.find((d) => d.id === 'u1');
  assert.ok(unclassified, 'unclassified document should survive');
  assert.equal(unclassified.visibility, VISIBILITY_UNCLASSIFIED);
  assert.equal(unclassified.title, 'Draft Notes');
});
