import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComparisonDraftSavePayload } from '../../src/pages/document-comparison/draftPayload.js';

// ─────────────────────────────────────────────────────────────────────────────
//  draftPayload – recipient fields
// ─────────────────────────────────────────────────────────────────────────────

test('draft payload includes recipientName and recipientEmail when provided', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'Test', docAText: 'A', docBText: 'B' },
    stepToSave: 2,
    recipientName: 'Sarah Chen',
    recipientEmail: 'Sarah@Company.com',
  });

  assert.equal(payload.recipient_name, 'Sarah Chen');
  // email is lowercased + trimmed
  assert.equal(payload.recipient_email, 'sarah@company.com');
});

test('draft payload normalises recipient_email to lowercase', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'T', docAText: '', docBText: '' },
    stepToSave: 1,
    recipientEmail: '  HELLO@EXAMPLE.COM  ',
  });

  assert.equal(payload.recipient_email, 'hello@example.com');
});

test('draft payload sets both recipient fields to null when omitted', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'T', docAText: '', docBText: '' },
    stepToSave: 1,
  });

  assert.equal(payload.recipient_name, null);
  assert.equal(payload.recipient_email, null);
});

test('draft payload sets recipient fields to null when empty strings are passed', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'T', docAText: '', docBText: '' },
    stepToSave: 1,
    recipientName: '',
    recipientEmail: '',
  });

  assert.equal(payload.recipient_name, null);
  assert.equal(payload.recipient_email, null);
});

// ─────────────────────────────────────────────────────────────────────────────
//  draftPayload – document title fields
// ─────────────────────────────────────────────────────────────────────────────

test('draft payload includes doc_a_title and doc_b_title when provided', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'T', docAText: 'A', docBText: 'B' },
    stepToSave: 2,
    docATitle: 'My NDA',
    docBTitle: 'Term Sheet',
  });

  assert.equal(payload.doc_a_title, 'My NDA');
  assert.equal(payload.doc_b_title, 'Term Sheet');
});

test('draft payload sets doc titles to null when omitted', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'T', docAText: '', docBText: '' },
    stepToSave: 1,
  });

  assert.equal(payload.doc_a_title, null);
  assert.equal(payload.doc_b_title, null);
});

test('draft payload includes all four new fields together', () => {
  const payload = buildComparisonDraftSavePayload({
    snapshot: { title: 'Full Test', docAText: 'confidential text', docBText: 'shared text' },
    stepToSave: 3,
    recipientName: 'Jo Smith',
    recipientEmail: 'jo@example.com',
    docATitle: 'Confidential NDA',
    docBTitle: 'Shared Terms',
  });

  assert.equal(payload.recipient_name, 'Jo Smith');
  assert.equal(payload.recipient_email, 'jo@example.com');
  assert.equal(payload.doc_a_title, 'Confidential NDA');
  assert.equal(payload.doc_b_title, 'Shared Terms');
  // Existing fields still present
  assert.equal(payload.doc_a_text, 'confidential text');
  assert.equal(payload.doc_b_text, 'shared text');
  assert.equal(payload.draft_step, 3);
});
