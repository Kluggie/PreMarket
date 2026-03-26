import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentComparisonNotificationHref,
  buildDocumentComparisonReportHref,
  buildLegacyOpportunityNotificationHref,
  buildNotificationTargetMetadata,
  buildSharedReportHref,
  resolveNotificationTarget,
} from '../../src/lib/notificationTargets.js';

test('AI mediation review notifications for document comparisons resolve to the true Step 0 shared-report route', () => {
  const comparisonId = 'comparison_58212317-e8dc-4e27-a213-9c62a80b4e76';
  const proposalId = 'proposal_84b5be32-aa88-459a-b5ea-02db9fe4530f';
  const sharedReportToken = 'shared_report_step0_abc123';
  const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });

  const target = resolveNotificationTarget({
    event_type: 'evaluation_update',
    action_url: legacyHref,
    metadata: buildNotificationTargetMetadata({
      route: 'SharedReport',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      proposalId,
      sharedReportToken,
      legacyActionUrl: legacyHref,
    }),
  });

  assert.equal(target.href, buildDocumentComparisonNotificationHref(sharedReportToken));
  assert.equal(target.route, 'SharedReport');
  assert.equal(target.tab, null);
  assert.equal(target.comparison_id, comparisonId);
  assert.equal(target.proposal_id, proposalId);
  assert.equal(target.shared_report_token, sharedReportToken);
  assert.equal(target.legacy_href, legacyHref);
  assert.equal(target.is_legacy_fallback, false);
});

test('notification routing prefers the shared-report Step 0 token when document-comparison metadata includes it', () => {
  const comparisonId = 'comparison_same_destination';
  const sharedReportToken = 'shared_report_same_destination';
  const target = resolveNotificationTarget({
    event_type: 'evaluation_update',
    metadata: buildNotificationTargetMetadata({
      route: 'SharedReport',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      sharedReportToken,
    }),
  });

  assert.equal(target.href, buildSharedReportHref(sharedReportToken));
});

test('agreement-request notifications for document comparisons resolve to the true Step 0 shared-report route when comparison metadata is present', () => {
  const comparisonId = 'comparison_agreement_requested';
  const proposalId = 'proposal_agreement_requested';
  const sharedReportToken = 'shared_report_agreement_requested';
  const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });

  const target = resolveNotificationTarget({
    event_type: 'status_won',
    action_url: buildSharedReportHref(sharedReportToken),
    metadata: buildNotificationTargetMetadata({
      route: 'SharedReport',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      proposalId,
      sharedReportToken,
      legacyActionUrl: legacyHref,
    }),
  });

  assert.equal(target.href, buildDocumentComparisonNotificationHref(sharedReportToken));
  assert.equal(target.route, 'SharedReport');
  assert.equal(target.tab, null);
  assert.equal(target.comparison_id, comparisonId);
  assert.equal(target.proposal_id, proposalId);
  assert.equal(target.shared_report_token, sharedReportToken);
  assert.equal(target.legacy_href, legacyHref);
});

test('document-comparison notifications ignore non-report tab metadata and still open Step 0', () => {
  const comparisonId = 'comparison_notification_step0';
  const sharedReportToken = 'shared_report_notification_step0';

  const target = resolveNotificationTarget({
    event_type: 'status_continue_negotiating',
    metadata: buildNotificationTargetMetadata({
      route: 'SharedReport',
      tab: 'details',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      sharedReportToken,
    }),
  });

  assert.equal(target.href, buildDocumentComparisonNotificationHref(sharedReportToken));
  assert.equal(target.tab, null);
  assert.equal(target.route, 'SharedReport');
});

test('older document-comparison action URLs pointing at DocumentComparisonDetail still resolve to shared-report when metadata has a token', () => {
  const comparisonId = 'comparison_legacy_doc_detail';
  const proposalId = 'proposal_legacy_doc_detail';
  const sharedReportToken = 'shared_report_from_metadata';

  const target = resolveNotificationTarget({
    event_type: 'status_won',
    action_url: buildDocumentComparisonReportHref(comparisonId),
    metadata: buildNotificationTargetMetadata({
      route: 'SharedReport',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      proposalId,
      sharedReportToken,
    }),
  });

  assert.equal(target.href, buildSharedReportHref(sharedReportToken));
  assert.equal(target.route, 'SharedReport');
});

test('true proposal-native notifications keep the existing proposal destination', () => {
  const proposalId = 'proposal_native_123';
  const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });

  const target = resolveNotificationTarget({
    event_type: 'new_proposal',
    action_url: legacyHref,
    metadata: {},
  });

  assert.equal(target.href, legacyHref);
  assert.equal(target.route, null);
  assert.equal(target.tab, null);
  assert.equal(target.comparison_id, null);
  assert.equal(target.is_legacy_fallback, true);
});

test('older notifications without comparison metadata fall back to the preserved legacy proposal route', () => {
  const proposalId = 'proposal_legacy_456';
  const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });

  const target = resolveNotificationTarget({
    event_type: 'evaluation_update',
    action_url: legacyHref,
    metadata: {},
  });

  assert.equal(target.href, legacyHref);
  assert.equal(target.comparison_id, null);
  assert.equal(target.legacy_href, legacyHref);
  assert.equal(target.is_legacy_fallback, true);
});
