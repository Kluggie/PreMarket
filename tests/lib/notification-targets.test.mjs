import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentComparisonReportHref,
  buildLegacyOpportunityNotificationHref,
  buildNotificationTargetMetadata,
  resolveNotificationTarget,
} from '../../src/lib/notificationTargets.js';

test('AI mediation review notifications for document comparisons resolve to the canonical report route', () => {
  const comparisonId = 'comparison_58212317-e8dc-4e27-a213-9c62a80b4e76';
  const proposalId = 'proposal_84b5be32-aa88-459a-b5ea-02db9fe4530f';
  const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });

  const target = resolveNotificationTarget({
    event_type: 'evaluation_update',
    action_url: legacyHref,
    metadata: buildNotificationTargetMetadata({
      route: 'DocumentComparisonDetail',
      tab: 'report',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      proposalId,
      legacyActionUrl: legacyHref,
    }),
  });

  assert.equal(target.href, buildDocumentComparisonReportHref(comparisonId));
  assert.equal(target.route, 'DocumentComparisonDetail');
  assert.equal(target.tab, 'report');
  assert.equal(target.comparison_id, comparisonId);
  assert.equal(target.proposal_id, proposalId);
  assert.equal(target.legacy_href, legacyHref);
  assert.equal(target.is_legacy_fallback, false);
});

test('notification routing matches the Opportunities comparison-report destination for the same comparison item', () => {
  const comparisonId = 'comparison_same_destination';
  const target = resolveNotificationTarget({
    event_type: 'evaluation_update',
    metadata: buildNotificationTargetMetadata({
      route: 'DocumentComparisonDetail',
      tab: 'report',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
    }),
  });

  assert.equal(target.href, buildDocumentComparisonReportHref(comparisonId));
});

test('agreement-request notifications for document comparisons resolve to the canonical report route when comparison metadata is present', () => {
  const comparisonId = 'comparison_agreement_requested';
  const proposalId = 'proposal_agreement_requested';
  const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });

  const target = resolveNotificationTarget({
    event_type: 'status_won',
    action_url: buildDocumentComparisonReportHref(comparisonId),
    metadata: buildNotificationTargetMetadata({
      route: 'DocumentComparisonDetail',
      tab: 'report',
      workflowType: 'document_comparison',
      entityType: 'document_comparison',
      comparisonId,
      proposalId,
      legacyActionUrl: legacyHref,
    }),
  });

  assert.equal(target.href, buildDocumentComparisonReportHref(comparisonId));
  assert.equal(target.route, 'DocumentComparisonDetail');
  assert.equal(target.tab, 'report');
  assert.equal(target.comparison_id, comparisonId);
  assert.equal(target.proposal_id, proposalId);
  assert.equal(target.legacy_href, legacyHref);
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
