import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGuestComparisonMigrationOverlay,
  buildGuestComparisonMigrationPayload,
} from '../../src/pages/document-comparison/guestPreviewMigration.js';
import {
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
} from '../../src/pages/document-comparison/documentsModel.js';

function buildGuestDraft(overrides = {}) {
  return {
    step: 3,
    title: 'Guest preview draft',
    documents: [
      {
        id: 'doc_confidential',
        title: 'Confidential package',
        visibility: VISIBILITY_CONFIDENTIAL,
        text: 'Confidential pricing and staffing terms.',
        html: '<p>Confidential pricing and staffing terms.</p>',
        json: null,
        source: 'typed',
        files: [],
      },
      {
        id: 'doc_shared',
        title: 'Shared package',
        visibility: VISIBILITY_SHARED,
        text: 'Shared implementation scope and service levels.',
        html: '<p>Shared implementation scope and service levels.</p>',
        json: null,
        source: 'typed',
        files: [],
      },
    ],
    recipientName: 'Taylor Buyer',
    recipientEmail: 'Taylor.Buyer@example.com',
    aiState: {
      suggestionThreads: [
        {
          id: 'thread_1',
          title: 'General improvements',
          entries: [
            {
              role: 'user',
              content: 'General Improvements',
              promptType: 'general',
            },
            {
              role: 'assistant',
              content: 'Tighten the shared implementation wording.',
              coachResultHash: 'coach_hash_1',
            },
          ],
        },
      ],
      activeSuggestionThreadId: 'thread_1',
    },
    guestEvaluationPreview: {
      completedAt: '2026-03-18T04:05:06.000Z',
      runCount: 1,
      limit: 1,
      report: {
        report_format: 'v2',
        fit_level: 'medium',
        why: ['Shared scope mostly aligns with the confidential requirements.'],
        missing: ['Clarify one remaining liability issue.'],
        redactions: [],
        summary: {
          fit_level: 'medium',
          top_fit_reasons: [{ text: 'Scope aligns.' }],
          top_blockers: [{ text: 'Liability issue remains.' }],
          next_actions: ['Resolve the liability issue.'],
        },
        sections: [],
        recommendation: 'Medium',
      },
    },
    ...overrides,
  };
}

test('buildGuestComparisonMigrationPayload preserves guest suggestion-thread metadata and bundled document content', () => {
  const payload = buildGuestComparisonMigrationPayload(buildGuestDraft(), {
    sanitizeHtml: (value) => String(value || ''),
  });

  assert.equal(payload.title, 'Guest preview draft');
  assert.equal(payload.draft_step, 3);
  assert.equal(payload.doc_a_text, 'Confidential pricing and staffing terms.');
  assert.equal(payload.doc_b_text, 'Shared implementation scope and service levels.');
  assert.equal(payload.recipient_name, 'Taylor Buyer');
  assert.equal(payload.recipient_email, 'taylor.buyer@example.com');
  assert.equal(payload.doc_a_title, 'Confidential package');
  assert.equal(payload.doc_b_title, 'Shared package');
  assert.equal(Array.isArray(payload.documents_session), true);
  assert.equal(payload.documents_session.length, 2);
  assert.equal(Array.isArray(payload.metadata?.suggestionThreads), true);
  assert.equal(payload.metadata?.suggestionThreads?.length, 1);
  assert.equal(payload.metadata?.activeSuggestionThreadId, 'thread_1');
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, 'guestEvaluationPreview'),
    false,
    'guest preview evaluation should not be written into the authenticated save payload',
  );
});

test('buildGuestComparisonMigrationOverlay carries the guest mediation preview for post-auth restoration only', () => {
  const overlay = buildGuestComparisonMigrationOverlay(
    buildGuestDraft(),
    'comparison_authenticated_123',
  );

  assert.deepEqual(overlay, {
    comparisonId: 'comparison_authenticated_123',
    step: 3,
    savedAt: overlay.savedAt,
    guestEvaluationPreview: buildGuestDraft().guestEvaluationPreview,
  });
  assert.equal(typeof overlay.savedAt, 'number');
});

test('buildGuestComparisonMigrationOverlay returns null when no guest mediation preview exists', () => {
  const overlay = buildGuestComparisonMigrationOverlay(
    buildGuestDraft({ guestEvaluationPreview: null }),
    'comparison_authenticated_456',
  );

  assert.equal(overlay, null);
});
