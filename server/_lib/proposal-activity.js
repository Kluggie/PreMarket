function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function normalizeEmail(value) {
  return asText(value).toLowerCase();
}

function toObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toDateValue(value) {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function getViewerRole(accessMode) {
  const normalized = asLower(accessMode);
  return normalized === 'recipient' || normalized === 'token' ? 'party_b' : 'party_a';
}

function getActorLabel(actorRole, accessMode) {
  const normalizedRole = asLower(actorRole);
  if (!normalizedRole) {
    return 'System';
  }

  const viewerRole = getViewerRole(accessMode);
  if (normalizedRole === viewerRole) {
    return 'You';
  }

  if (normalizedRole === 'party_a' || normalizedRole === 'party_b') {
    return 'Counterparty';
  }

  return 'System';
}

function buildDescription(actorLabel, text) {
  if (actorLabel === 'System') {
    return text;
  }
  return actorLabel === 'You' ? `You ${text}` : `${actorLabel} ${text}`;
}

function mapEventTypeToActivity(row, accessMode) {
  const eventType = asLower(row?.eventType);
  const actorLabel = getActorLabel(row?.actorRole, accessMode);

  switch (eventType) {
    case 'proposal.created':
      return {
        kind: 'file',
        tone: 'info',
        title: 'Opportunity Created',
        description: buildDescription(actorLabel, 'created the live opportunity.'),
      };
    case 'proposal.sent':
      return {
        kind: 'file',
        tone: 'info',
        title: 'Opportunity Sent',
        description: buildDescription(actorLabel, 'shared the current live opportunity.'),
      };
    case 'proposal.received':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: 'Recipient Response',
        description: buildDescription(actorLabel, 'submitted updated terms.'),
      };
    case 'proposal.send_back':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: 'Revised Terms Sent',
        description: buildDescription(actorLabel, 'sent revised terms back.'),
      };
    case 'proposal.evaluated':
      return {
        kind: 'sparkles',
        tone: 'success',
        title: 'AI Mediation Updated',
        description: buildDescription(actorLabel, 'ran AI mediation on the live opportunity.'),
      };
    case 'proposal.re_evaluated':
      return {
        kind: 'sparkles',
        tone: 'success',
        title: 'AI Mediation Refreshed',
        description: buildDescription(actorLabel, 'updated the opportunity and refreshed the mediation review.'),
      };
    case 'proposal.outcome.won_requested':
      return {
        kind: 'clock',
        tone: 'warning',
        title: 'Requested Agreement',
        description: buildDescription(actorLabel, 'requested agreement.'),
      };
    case 'proposal.outcome.continue_negotiation':
      return {
        kind: 'clock',
        tone: 'warning',
        title: 'Continued Negotiating',
        description: buildDescription(actorLabel, 'chose to continue negotiating.'),
      };
    case 'proposal.outcome.won_confirmed':
      return {
        kind: 'check',
        tone: 'success',
        title: 'Agreement Confirmed',
        description: buildDescription(actorLabel, 'confirmed the agreement.'),
      };
    case 'proposal.outcome.lost':
      return {
        kind: 'x',
        tone: 'danger',
        title: 'Marked Lost',
        description: buildDescription(actorLabel, 'closed the opportunity as lost.'),
      };
    case 'proposal.archived':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: 'Archived',
        description: buildDescription(actorLabel, 'archived the opportunity.'),
      };
    case 'proposal.unarchived':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: 'Returned to Active',
        description: buildDescription(actorLabel, 'returned the opportunity to the active workspace.'),
      };
    default:
      return null;
  }
}

function addTextToSet(set, value) {
  const normalized = asText(value);
  if (normalized) {
    set.add(normalized);
  }
}

function addEmailToSet(set, value) {
  const normalized = normalizeEmail(value);
  if (normalized) {
    set.add(normalized);
  }
}

function setIntersects(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set) || left.size === 0 || right.size === 0) {
    return false;
  }
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function buildEmptyScopeSets() {
  return {
    linkIds: new Set(),
    linkTokens: new Set(),
    recipientEmails: new Set(),
    revisionIds: new Set(),
    evaluationRunIds: new Set(),
    comparisonIds: new Set(),
  };
}

function mergeScopeSets(target, source) {
  if (!target || !source) {
    return;
  }
  [
    'linkIds',
    'linkTokens',
    'recipientEmails',
    'revisionIds',
    'evaluationRunIds',
    'comparisonIds',
  ].forEach((key) => {
    const targetSet = target[key];
    const sourceSet = source[key];
    if (!(targetSet instanceof Set) || !(sourceSet instanceof Set)) {
      return;
    }
    sourceSet.forEach((value) => targetSet.add(value));
  });
}

function hasScopeSignals(scopeSets) {
  return [
    scopeSets?.linkIds,
    scopeSets?.linkTokens,
    scopeSets?.recipientEmails,
    scopeSets?.revisionIds,
    scopeSets?.evaluationRunIds,
    scopeSets?.comparisonIds,
  ].some((set) => set instanceof Set && set.size > 0);
}

const THREAD_SCOPED_EVENT_TYPES = new Set([
  'proposal.sent',
  'proposal.received',
  'proposal.send_back',
]);

function extractVersionSnapshotScope(snapshotValue) {
  const snapshot = toObject(snapshotValue);
  const scope = buildEmptyScopeSets();

  const proposal = toObject(snapshot.proposal);
  addEmailToSet(scope.recipientEmails, proposal.partyBEmail || proposal.party_b_email);
  addTextToSet(scope.comparisonIds, proposal.documentComparisonId || proposal.document_comparison_id);

  const sharedLinks = toArray(snapshot.sharedLinks || snapshot.shared_links);
  sharedLinks.forEach((entry) => {
    const link = toObject(entry);
    const metadata = toObject(link.reportMetadata || link.report_metadata);
    addTextToSet(scope.linkIds, link.id || link.linkId || link.shared_link_id);
    addTextToSet(scope.linkTokens, link.token || link.share_token);
    addEmailToSet(scope.recipientEmails, link.recipientEmail || link.recipient_email);
    addTextToSet(scope.comparisonIds, metadata.comparison_id || metadata.comparisonId);
  });

  const recipientRevisions = toArray(snapshot.recipientRevisions || snapshot.recipient_revisions);
  recipientRevisions.forEach((entry) => {
    const revision = toObject(entry);
    addTextToSet(scope.linkIds, revision.sharedLinkId || revision.shared_link_id);
    addTextToSet(scope.revisionIds, revision.id || revision.revision_id);
    addTextToSet(scope.comparisonIds, revision.comparisonId || revision.comparison_id);
  });

  const evaluations = toArray(snapshot.evaluations);
  evaluations.forEach((entry) => {
    const evaluation = toObject(entry);
    addTextToSet(scope.evaluationRunIds, evaluation.evaluationRunId || evaluation.evaluation_run_id);
    addTextToSet(scope.revisionIds, evaluation.revisionId || evaluation.revision_id);
    addTextToSet(scope.linkIds, evaluation.sharedLinkId || evaluation.shared_link_id);
    addTextToSet(scope.comparisonIds, evaluation.comparisonId || evaluation.comparison_id);
  });

  const documentComparison = toObject(snapshot.documentComparison || snapshot.document_comparison);
  addTextToSet(scope.comparisonIds, documentComparison.id);

  return scope;
}

function extractEventRowScope(row) {
  const eventData = toObject(row?.eventData || row?.event_data);
  const scope = buildEmptyScopeSets();
  addTextToSet(
    scope.linkIds,
    eventData.shared_link_id ||
      eventData.sharedLinkId ||
      eventData.link_id ||
      eventData.linkId ||
      eventData.share_id ||
      eventData.shareId ||
      eventData.shared_report_link_id ||
      eventData.sharedReportLinkId,
  );
  addTextToSet(
    scope.linkTokens,
    eventData.shared_link_token ||
      eventData.sharedLinkToken ||
      eventData.share_token ||
      eventData.shareToken ||
      eventData.link_token ||
      eventData.linkToken ||
      eventData.token,
  );
  addEmailToSet(scope.recipientEmails, eventData.recipient_email || eventData.recipientEmail);
  addTextToSet(scope.revisionIds, eventData.revision_id || eventData.revisionId);
  addTextToSet(
    scope.evaluationRunIds,
    eventData.evaluation_run_id || eventData.evaluationRunId,
  );
  addTextToSet(
    scope.comparisonIds,
    eventData.comparison_id ||
      eventData.comparisonId ||
      eventData.document_comparison_id ||
      eventData.documentComparisonId,
  );

  const versionSnapshotScope = extractVersionSnapshotScope(
    row?.versionSnapshot || row?.version_snapshot || row?.snapshotData || row?.snapshot_data,
  );
  mergeScopeSets(scope, versionSnapshotScope);

  return {
    ...scope,
    hasScopedSignals: hasScopeSignals(scope),
  };
}

function buildSharedReportScope(options = {}) {
  const scope = buildEmptyScopeSets();
  toArray(options.lineageLinkIds).forEach((value) => addTextToSet(scope.linkIds, value));
  toArray(options.lineageLinkTokens).forEach((value) => addTextToSet(scope.linkTokens, value));
  toArray(options.lineageRecipientEmails).forEach((value) => addEmailToSet(scope.recipientEmails, value));
  toArray(options.lineageRevisionIds).forEach((value) => addTextToSet(scope.revisionIds, value));
  toArray(options.lineageEvaluationRunIds).forEach((value) =>
    addTextToSet(scope.evaluationRunIds, value),
  );
  toArray(options.lineageComparisonIds).forEach((value) => addTextToSet(scope.comparisonIds, value));
  addTextToSet(scope.comparisonIds, options.comparisonId);

  return {
    ...scope,
    hasScope: hasScopeSignals(scope),
  };
}

function isSharedReportScopedEvent(row, scope) {
  if (!scope?.hasScope) {
    return true;
  }

  const eventType = asLower(row?.eventType || row?.event_type);
  const isThreadScopedEvent = THREAD_SCOPED_EVENT_TYPES.has(eventType);
  const eventScope = extractEventRowScope(row);
  if (setIntersects(eventScope.linkIds, scope.linkIds)) {
    return true;
  }
  if (setIntersects(eventScope.linkTokens, scope.linkTokens)) {
    return true;
  }
  if (setIntersects(eventScope.revisionIds, scope.revisionIds)) {
    return true;
  }
  if (setIntersects(eventScope.evaluationRunIds, scope.evaluationRunIds)) {
    return true;
  }

  if (isThreadScopedEvent) {
    if (eventScope.recipientEmails.size > 0) {
      return setIntersects(eventScope.recipientEmails, scope.recipientEmails);
    }
    // Reject ambiguous thread-scoped events that only carry broad
    // proposal/comparison scope to prevent sibling-recipient contamination.
    return false;
  }

  if (setIntersects(eventScope.comparisonIds, scope.comparisonIds)) {
    return true;
  }
  if (eventScope.hasScopedSignals) {
    return false;
  }

  // Proposal-global milestones (for example "Opportunity Created") do not
  // carry recipient/link scope and remain visible to preserve context.
  return true;
}

export function buildProposalActivityHistory(rows, options = {}) {
  const accessMode = asText(options.accessMode) || 'owner';
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : 8;

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const activity = mapEventTypeToActivity(row, accessMode);
      if (!activity) {
        return null;
      }

      const createdAt = toDateValue(row?.createdAt);
      return {
        id: asText(row?.id) || `${asLower(row?.eventType)}:${createdAt?.toISOString() || 'unknown'}`,
        event_type: asText(row?.eventType) || null,
        actor_role: asText(row?.actorRole) || null,
        actor_label: getActorLabel(row?.actorRole, accessMode),
        created_date: createdAt ? createdAt.toISOString() : null,
        ...activity,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = toDateValue(left?.created_date)?.getTime() || 0;
      const rightTime = toDateValue(right?.created_date)?.getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

export function buildSharedReportScopedActivityHistory(rows, options = {}) {
  const scope = buildSharedReportScope(options.scope || {});
  const scopedRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    isSharedReportScopedEvent(row, scope),
  );

  return buildProposalActivityHistory(scopedRows, {
    accessMode: options.accessMode,
    limit: options.limit,
  });
}
