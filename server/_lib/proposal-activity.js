function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
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
