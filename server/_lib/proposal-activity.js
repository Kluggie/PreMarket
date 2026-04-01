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

function normalizeParticipant(value) {
  const participant = toObject(value);
  return {
    name:
      asText(participant.name) ||
      asText(participant.display_name) ||
      asText(participant.displayName),
    company:
      asText(participant.company) ||
      asText(participant.company_name) ||
      asText(participant.companyName),
    email: normalizeEmail(participant.email),
  };
}

function resolveParticipantContext(options = {}) {
  const context = toObject(options.participantContext || options.participant_context);
  return {
    party_a: normalizeParticipant(context.partyA || context.party_a),
    party_b: normalizeParticipant(context.partyB || context.party_b),
  };
}

function resolveCounterpartyLabel(actorRole, options = {}) {
  const participants = resolveParticipantContext(options);
  const participant = asLower(actorRole) === 'party_b' ? participants.party_b : participants.party_a;
  if (participant.name) {
    return participant.name;
  }
  if (participant.company) {
    return participant.company;
  }
  return 'They';
}

function getActorLabel(actorRole, accessMode, options = {}) {
  const normalizedRole = asLower(actorRole);
  if (!normalizedRole) {
    return 'System';
  }

  const viewerRole = getViewerRole(accessMode);
  if (normalizedRole === viewerRole) {
    return 'You';
  }

  if (normalizedRole === 'party_a' || normalizedRole === 'party_b') {
    return resolveCounterpartyLabel(normalizedRole, options);
  }

  return 'System';
}

function buildActorActionTitle(actorLabel, actionText) {
  if (actorLabel === 'System') {
    return actionText;
  }
  return `${actorLabel} ${actionText}`;
}

function mapEventTypeToActivity(row, options = {}) {
  const eventType = asLower(row?.eventType);
  const accessMode = asText(options.accessMode) || 'owner';
  const actorLabel = getActorLabel(row?.actorRole, accessMode, options);

  switch (eventType) {
    case 'proposal.created':
      return {
        kind: 'file',
        tone: 'info',
        title: buildActorActionTitle(actorLabel, 'created the opportunity'),
        description: '',
      };
    case 'proposal.sent':
      return {
        kind: 'file',
        tone: 'info',
        title: buildActorActionTitle(actorLabel, 'sent the opportunity'),
        description: '',
      };
    case 'proposal.received':
    case 'proposal.send_back':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: buildActorActionTitle(actorLabel, 'sent revised terms'),
        description: '',
      };
    case 'proposal.evaluated':
    case 'proposal.re_evaluated':
      // Exclude AI processing noise from the primary negotiation timeline.
      return null;
    case 'proposal.outcome.won_requested':
      return {
        kind: 'clock',
        tone: 'warning',
        title: buildActorActionTitle(actorLabel, 'requested agreement'),
        description: '',
      };
    case 'proposal.outcome.continue_negotiation':
      return {
        kind: 'clock',
        tone: 'warning',
        title: buildActorActionTitle(actorLabel, 'continued negotiating'),
        description: '',
      };
    case 'proposal.outcome.won_confirmed':
      return {
        kind: 'check',
        tone: 'success',
        title: 'Agreement finalized',
        description: '',
      };
    case 'proposal.outcome.lost':
      return {
        kind: 'x',
        tone: 'danger',
        title: buildActorActionTitle(actorLabel, 'marked the opportunity as lost'),
        description: '',
      };
    case 'proposal.archived':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: buildActorActionTitle(actorLabel, 'archived the opportunity'),
        description: '',
      };
    case 'proposal.unarchived':
      return {
        kind: 'clock',
        tone: 'neutral',
        title: buildActorActionTitle(actorLabel, 'returned the opportunity to active'),
        description: '',
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

function extractVersionSnapshotScope(snapshotValue, options = {}) {
  const snapshot = toObject(snapshotValue);
  const scope = buildEmptyScopeSets();
  const includeSharedLinks = options.includeSharedLinks !== false;
  const includeRecipientRevisions = options.includeRecipientRevisions !== false;
  const includeEvaluations = options.includeEvaluations !== false;

  const proposal = toObject(snapshot.proposal);
  addEmailToSet(scope.recipientEmails, proposal.partyBEmail || proposal.party_b_email);
  addTextToSet(scope.comparisonIds, proposal.documentComparisonId || proposal.document_comparison_id);

  if (includeSharedLinks) {
    const sharedLinks = toArray(snapshot.sharedLinks || snapshot.shared_links);
    sharedLinks.forEach((entry) => {
      const link = toObject(entry);
      const metadata = toObject(link.reportMetadata || link.report_metadata);
      addTextToSet(scope.linkIds, link.id || link.linkId || link.shared_link_id);
      addTextToSet(scope.linkTokens, link.token || link.share_token);
      addEmailToSet(scope.recipientEmails, link.recipientEmail || link.recipient_email);
      addTextToSet(scope.comparisonIds, metadata.comparison_id || metadata.comparisonId);
    });
  }

  if (includeRecipientRevisions) {
    const recipientRevisions = toArray(snapshot.recipientRevisions || snapshot.recipient_revisions);
    recipientRevisions.forEach((entry) => {
      const revision = toObject(entry);
      addTextToSet(scope.linkIds, revision.sharedLinkId || revision.shared_link_id);
      addTextToSet(scope.revisionIds, revision.id || revision.revision_id);
      addTextToSet(scope.comparisonIds, revision.comparisonId || revision.comparison_id);
    });
  }

  if (includeEvaluations) {
    const evaluations = toArray(snapshot.evaluations);
    evaluations.forEach((entry) => {
      const evaluation = toObject(entry);
      addTextToSet(scope.evaluationRunIds, evaluation.evaluationRunId || evaluation.evaluation_run_id);
      addTextToSet(scope.revisionIds, evaluation.revisionId || evaluation.revision_id);
      addTextToSet(scope.linkIds, evaluation.sharedLinkId || evaluation.shared_link_id);
      addTextToSet(scope.comparisonIds, evaluation.comparisonId || evaluation.comparison_id);
    });
  }

  const documentComparison = toObject(snapshot.documentComparison || snapshot.document_comparison);
  addTextToSet(scope.comparisonIds, documentComparison.id);

  return scope;
}

function extractEventRowScope(row, options = {}) {
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
    options,
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

const STRONG_THREAD_SCOPE_REASONS = new Set([
  'link_id',
  'link_token',
  'revision_id',
  'evaluation_run_id',
]);

function buildSnapshotScopeOptions(eventType, isThreadScopedEvent) {
  const snapshotScopeOptions = {
    includeSharedLinks: !isThreadScopedEvent,
    includeRecipientRevisions: true,
    includeEvaluations: true,
  };

  if (eventType === 'proposal.sent' || eventType === 'proposal.received') {
    // For sent/received, snapshot recipient-revision/evaluation arrays can be
    // proposal-wide and contaminate sibling threads. Prefer eventData +
    // recipient-level fallback only.
    snapshotScopeOptions.includeRecipientRevisions = false;
    snapshotScopeOptions.includeEvaluations = false;
  }

  return snapshotScopeOptions;
}

function evaluateSharedReportScopedEvent(row, scope) {
  const eventType = asLower(row?.eventType || row?.event_type);
  const isThreadScopedEvent = THREAD_SCOPED_EVENT_TYPES.has(eventType);
  const snapshotScopeOptions = buildSnapshotScopeOptions(eventType, isThreadScopedEvent);
  const eventScope = extractEventRowScope(row, {
    // proposal_versions.snapshot_data can carry proposal-wide collections.
    // Thread events should primarily match via eventData and narrow fallback
    // signals, not broad proposal-level arrays.
    ...snapshotScopeOptions,
  });
  const matches = {
    link_id: setIntersects(eventScope.linkIds, scope.linkIds),
    link_token: setIntersects(eventScope.linkTokens, scope.linkTokens),
    revision_id: setIntersects(eventScope.revisionIds, scope.revisionIds),
    evaluation_run_id: setIntersects(eventScope.evaluationRunIds, scope.evaluationRunIds),
    recipient_email: setIntersects(eventScope.recipientEmails, scope.recipientEmails),
    comparison_id: setIntersects(eventScope.comparisonIds, scope.comparisonIds),
  };

  let included = false;
  let reason = 'excluded';

  if (!scope?.hasScope) {
    included = true;
    reason = 'no_scope';
  } else if (matches.link_id) {
    included = true;
    reason = 'link_id';
  } else if (matches.link_token) {
    included = true;
    reason = 'link_token';
  } else if (matches.revision_id) {
    included = true;
    reason = 'revision_id';
  } else if (matches.evaluation_run_id) {
    included = true;
    reason = 'evaluation_run_id';
  } else if (isThreadScopedEvent) {
    if (eventScope.recipientEmails.size > 0) {
      included = matches.recipient_email;
      reason = matches.recipient_email ? 'thread_recipient_email' : 'thread_recipient_miss';
    } else {
      included = false;
      reason = 'thread_no_scoped_signal';
    }
  } else if (matches.comparison_id) {
    included = true;
    reason = 'comparison_id';
  } else if (eventScope.hasScopedSignals) {
    included = false;
    reason = 'scoped_signal_miss';
  } else {
    included = true;
    reason = 'global_fallback';
  }

  return {
    eventType,
    isThreadScopedEvent,
    eventScope,
    matches,
    included,
    reason,
  };
}

function isSharedReportScopedEvent(row, scope) {
  return evaluateSharedReportScopedEvent(row, scope).included;
}

export function buildProposalActivityHistory(rows, options = {}) {
  const accessMode = asText(options.accessMode) || 'owner';
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : 8;

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const activity = mapEventTypeToActivity(row, {
        ...options,
        accessMode,
      });
      if (!activity) {
        return null;
      }

      const createdAt = toDateValue(row?.createdAt);
      return {
        id: asText(row?.id) || `${asLower(row?.eventType)}:${createdAt?.toISOString() || 'unknown'}`,
        event_type: asText(row?.eventType) || null,
        actor_role: asText(row?.actorRole) || null,
        actor_label: getActorLabel(row?.actorRole, accessMode, options),
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
  const list = Array.isArray(rows) ? rows : [];
  let scopedRowsWithMeta = list
    .map((row) => ({
      row,
      scopeResult: evaluateSharedReportScopedEvent(row, scope),
    }))
    .filter((entry) => entry.scopeResult.included);

  const fallbackSentRows = scopedRowsWithMeta.filter(
    (entry) =>
      entry.scopeResult.eventType === 'proposal.sent' &&
      entry.scopeResult.reason === 'thread_recipient_email',
  );
  if (fallbackSentRows.length > 0) {
    const strongSentRows = scopedRowsWithMeta.filter(
      (entry) =>
        entry.scopeResult.eventType === 'proposal.sent' &&
        STRONG_THREAD_SCOPE_REASONS.has(entry.scopeResult.reason),
    );
    if (strongSentRows.length > 0) {
      scopedRowsWithMeta = scopedRowsWithMeta.filter(
        (entry) =>
          !(
            entry.scopeResult.eventType === 'proposal.sent' &&
            entry.scopeResult.reason === 'thread_recipient_email'
          ),
      );
    } else if (fallbackSentRows.length > 1) {
      const keptFallback = [...fallbackSentRows].sort((left, right) => {
        const leftTime =
          toDateValue(left.row?.createdAt || left.row?.created_at)?.getTime() || 0;
        const rightTime =
          toDateValue(right.row?.createdAt || right.row?.created_at)?.getTime() || 0;
        return rightTime - leftTime;
      })[0];
      scopedRowsWithMeta = scopedRowsWithMeta.filter(
        (entry) =>
          !(
            entry.scopeResult.eventType === 'proposal.sent' &&
            entry.scopeResult.reason === 'thread_recipient_email'
          ) || entry.row === keptFallback.row,
      );
    }
  }
  const scopedRows = scopedRowsWithMeta.map((entry) => entry.row);

  return buildProposalActivityHistory(scopedRows, {
    accessMode: options.accessMode,
    limit: options.limit,
    participantContext: options.participantContext,
  });
}

export function explainSharedReportScopedRows(rows, options = {}) {
  const scope = buildSharedReportScope(options.scope || {});
  const list = Array.isArray(rows) ? rows : [];

  return list.map((row) => {
    const scopeResult = evaluateSharedReportScopedEvent(row, scope);
    const eventType = scopeResult.eventType;
    const eventScope = scopeResult.eventScope;
    const matches = scopeResult.matches;
    const included = scopeResult.included;
    const reason = scopeResult.reason;

    const eventData = toObject(row?.eventData || row?.event_data);
    return {
      id: asText(row?.id) || null,
      event_type: eventType || null,
      created_at: toDateValue(row?.createdAt || row?.created_at)?.toISOString() || null,
      included,
      reason,
      matches,
      event_data: {
        comparison_id: eventData.comparison_id || eventData.comparisonId || null,
        shared_link_id: eventData.shared_link_id || eventData.sharedLinkId || null,
        shared_link_token: eventData.shared_link_token || eventData.sharedLinkToken || null,
        recipient_email: eventData.recipient_email || eventData.recipientEmail || null,
        revision_id: eventData.revision_id || eventData.revisionId || null,
        evaluation_run_id: eventData.evaluation_run_id || eventData.evaluationRunId || null,
      },
      scope_values: {
        link_ids: Array.from(eventScope.linkIds),
        link_tokens: Array.from(eventScope.linkTokens),
        recipient_emails: Array.from(eventScope.recipientEmails),
        revision_ids: Array.from(eventScope.revisionIds),
        evaluation_run_ids: Array.from(eventScope.evaluationRunIds),
        comparison_ids: Array.from(eventScope.comparisonIds),
      },
    };
  });
}
