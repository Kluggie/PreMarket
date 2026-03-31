const DEFAULT_NOTIFICATION_FALLBACK_HREF = '/Opportunities';
const DOCUMENT_COMPARISON_MIN_STEP = 1;
const DOCUMENT_COMPARISON_MAX_STEP = 3;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRouteKey(value) {
  return asText(value)
    .replace(/^\/+/, '')
    .toLowerCase();
}

function parseHref(value) {
  const text = asText(value);
  if (!text) {
    return null;
  }

  try {
    return new URL(text, 'https://premarket.local');
  } catch {
    return null;
  }
}

function parseDocumentComparisonTargetFromHref(actionUrl) {
  const parsed = parseHref(actionUrl);
  if (!parsed) {
    return null;
  }

  if (normalizeRouteKey(parsed.pathname) !== 'documentcomparisondetail') {
    return null;
  }

  const comparisonId = asText(parsed.searchParams.get('id'));
  if (!comparisonId) {
    return null;
  }

  return {
    comparisonId,
    tab: asText(parsed.searchParams.get('tab')) || null,
  };
}

function parseSharedReportTargetFromHref(actionUrl) {
  const parsed = parseHref(actionUrl);
  if (!parsed) {
    return null;
  }

  const routeKey = normalizeRouteKey(parsed.pathname);
  if (routeKey === 'sharedreport') {
    const sharedReportToken = asText(parsed.searchParams.get('token'));
    return sharedReportToken ? { sharedReportToken } : null;
  }

  const segments = String(parsed.pathname || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 2 && segments[0].toLowerCase() === 'shared-report') {
    const sharedReportToken = asText(segments[1]);
    return sharedReportToken ? { sharedReportToken } : null;
  }

  return null;
}

function clampDocumentComparisonStep(value) {
  const numeric = Number(value || DOCUMENT_COMPARISON_MIN_STEP);
  if (!Number.isFinite(numeric)) {
    return DOCUMENT_COMPARISON_MIN_STEP;
  }

  return Math.max(
    DOCUMENT_COMPARISON_MIN_STEP,
    Math.min(DOCUMENT_COMPARISON_MAX_STEP, Math.floor(numeric)),
  );
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function isActiveSharedReportStatus(value) {
  const normalizedStatus = asText(value).toLowerCase();
  return !normalizedStatus || normalizedStatus === 'active';
}

function isExpiredSharedReportLink(expiresAt) {
  const expiresAtDate = toDateOrNull(expiresAt);
  return Boolean(expiresAtDate && expiresAtDate.getTime() <= Date.now());
}

function readNotificationTargetMetadata(metadata) {
  const source = toObject(metadata);
  const target = toObject(source.target);

  return {
    route: asText(target.route || target.target_route || source.target_route || source.route),
    tab: asText(target.tab || source.target_tab || source.tab),
    workflowType: asText(
      target.workflow_type ||
        target.workflowType ||
        source.workflow_type ||
        source.workflowType,
    ),
    entityType: asText(
      target.entity_type ||
        target.entityType ||
        source.entity_type ||
        source.entityType,
    ),
    comparisonId: asText(
      target.comparison_id ||
        target.comparisonId ||
        source.comparison_id ||
        source.comparisonId ||
        source.document_comparison_id ||
        source.documentComparisonId,
    ),
    proposalId: asText(
      target.proposal_id ||
        target.proposalId ||
        source.proposal_id ||
        source.proposalId,
    ),
    sharedReportToken: asText(
      target.shared_report_token ||
        target.sharedReportToken ||
        source.shared_report_token ||
        source.sharedReportToken,
    ),
    legacyActionUrl: asText(source.legacy_action_url || source.legacyActionUrl),
  };
}

export function buildDocumentComparisonDetailHref({ comparisonId, tab } = {}) {
  const normalizedComparisonId = asText(comparisonId);
  if (!normalizedComparisonId) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('id', normalizedComparisonId);

  const normalizedTab = asText(tab);
  if (normalizedTab) {
    params.set('tab', normalizedTab);
  }

  return `/DocumentComparisonDetail?${params.toString()}`;
}

export function buildDocumentComparisonEditorHref({ comparisonId, proposalId, step } = {}) {
  const normalizedComparisonId = asText(comparisonId);
  if (!normalizedComparisonId) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('draft', normalizedComparisonId);

  const normalizedProposalId = asText(proposalId);
  if (normalizedProposalId) {
    params.set('proposalId', normalizedProposalId);
  }

  params.set('step', String(clampDocumentComparisonStep(step)));
  return `/DocumentComparisonCreate?${params.toString()}`;
}

export function buildSharedReportHref(sharedReportToken) {
  const normalizedSharedReportToken = asText(sharedReportToken);
  if (!normalizedSharedReportToken) {
    return null;
  }

  return `/shared-report/${encodeURIComponent(normalizedSharedReportToken)}`;
}

export function buildActiveSharedReportHref({
  sharedReportToken,
  sharedReportStatus,
  sharedReportExpiresAt,
} = {}) {
  const normalizedSharedReportToken = asText(sharedReportToken);
  if (!normalizedSharedReportToken) {
    return null;
  }

  if (!isActiveSharedReportStatus(sharedReportStatus)) {
    return null;
  }

  if (isExpiredSharedReportLink(sharedReportExpiresAt)) {
    return null;
  }

  return buildSharedReportHref(normalizedSharedReportToken);
}

export function buildDocumentComparisonReportHref(comparisonId) {
  return buildDocumentComparisonDetailHref({
    comparisonId,
    tab: 'report',
  });
}

export function buildDocumentComparisonResumeHref({ comparisonId, proposalId, resumeStep } = {}) {
  const normalizedComparisonId = asText(comparisonId);
  if (!normalizedComparisonId) {
    return null;
  }

  const normalizedResumeStep = clampDocumentComparisonStep(resumeStep);
  if (normalizedResumeStep >= 3) {
    return buildDocumentComparisonReportHref(normalizedComparisonId);
  }

  return buildDocumentComparisonEditorHref({
    comparisonId: normalizedComparisonId,
    proposalId,
    step: normalizedResumeStep,
  });
}

export function buildDocumentComparisonNotificationHref(sharedReportToken) {
  // Notification clicks intentionally re-anchor on the true Step 0 shared
  // workspace, not the editor resume step or the owner report view.
  return buildActiveSharedReportHref({ sharedReportToken });
}

export function buildDocumentComparisonOpportunityHref(proposal = {}) {
  const comparisonId = asText(
    proposal?.document_comparison_id || proposal?.documentComparisonId,
  );
  if (!comparisonId) {
    return null;
  }

  const sharedWorkspaceHref = buildActiveSharedReportHref({
    sharedReportToken: proposal?.shared_report_token || proposal?.sharedReportToken,
    sharedReportStatus: proposal?.shared_report_status || proposal?.sharedReportStatus,
    sharedReportExpiresAt:
      proposal?.shared_report_expires_at || proposal?.sharedReportExpiresAt,
  });

  if (sharedWorkspaceHref) {
    return sharedWorkspaceHref;
  }

  return buildDocumentComparisonResumeHref({
    comparisonId,
    proposalId: proposal?.id || proposal?.proposalId,
    resumeStep:
      proposal?.resume_step ||
      proposal?.resumeStep ||
      proposal?.draft_step ||
      proposal?.draftStep ||
      1,
  });
}

export function buildLegacyOpportunityNotificationHref({ actionUrl, proposalId } = {}) {
  const explicitActionUrl = asText(actionUrl);
  if (explicitActionUrl) {
    return explicitActionUrl;
  }

  const normalizedProposalId = asText(proposalId);
  if (!normalizedProposalId) {
    return null;
  }

  // Historical notification targets pointed at ProposalDetail, which App.jsx
  // still redirects to the legacy OpportunityDetail experience.
  return `/ProposalDetail?id=${encodeURIComponent(normalizedProposalId)}`;
}

export function buildNotificationTargetMetadata({
  route,
  tab,
  workflowType,
  entityType,
  comparisonId,
  proposalId,
  sharedReportToken,
  legacyActionUrl,
} = {}) {
  const target = {};

  if (asText(route)) {
    target.route = asText(route);
  }
  if (asText(tab)) {
    target.tab = asText(tab);
  }
  if (asText(workflowType)) {
    target.workflow_type = asText(workflowType);
  }
  if (asText(entityType)) {
    target.entity_type = asText(entityType);
  }
  if (asText(comparisonId)) {
    target.comparison_id = asText(comparisonId);
  }
  if (asText(proposalId)) {
    target.proposal_id = asText(proposalId);
  }
  if (asText(sharedReportToken)) {
    target.shared_report_token = asText(sharedReportToken);
  }

  const metadata = {};
  if (Object.keys(target).length > 0) {
    metadata.target = target;
  }
  if (asText(legacyActionUrl)) {
    metadata.legacy_action_url = asText(legacyActionUrl);
  }

  return metadata;
}

export function resolveNotificationTarget(notification, options = {}) {
  const fallbackHref = asText(options.fallbackHref) || DEFAULT_NOTIFICATION_FALLBACK_HREF;
  const actionUrl = asText(notification?.action_url || notification?.actionUrl);
  const eventType = asText(notification?.event_type || notification?.eventType).toLowerCase();
  const metadata = readNotificationTargetMetadata(notification?.metadata);
  const actionComparisonTarget = parseDocumentComparisonTargetFromHref(actionUrl);
  const actionSharedReportTarget = parseSharedReportTargetFromHref(actionUrl);

  const comparisonId = metadata.comparisonId || actionComparisonTarget?.comparisonId || '';
  const proposalId = metadata.proposalId || '';
  const sharedReportToken =
    metadata.sharedReportToken || actionSharedReportTarget?.sharedReportToken || '';
  const routeKey = normalizeRouteKey(metadata.route || '');
  const workflowType = asText(metadata.workflowType).toLowerCase();
  const entityType = asText(metadata.entityType).toLowerCase();
  const isCanonicalSharedReportTarget =
    Boolean(sharedReportToken) &&
    (
      routeKey === 'sharedreport' ||
      routeKey === 'shared-report' ||
      routeKey === 'shared-report/[token]' ||
      workflowType === 'document_comparison' ||
      entityType === 'document_comparison' ||
      Boolean(actionSharedReportTarget)
    );

  if (isCanonicalSharedReportTarget) {
    const href = buildActiveSharedReportHref({ sharedReportToken });
    const legacyHref =
      metadata.legacyActionUrl ||
      buildLegacyOpportunityNotificationHref({ actionUrl, proposalId });

    return {
      href: href || legacyHref || fallbackHref,
      route: 'SharedReport',
      tab: null,
      workflow_type: workflowType || 'document_comparison',
      entity_type: entityType || 'document_comparison',
      comparison_id: comparisonId || null,
      proposal_id: proposalId || null,
      shared_report_token: sharedReportToken,
      is_legacy_fallback: !href,
      legacy_href: legacyHref || null,
    };
  }

  const isCanonicalDocumentComparisonTarget =
    Boolean(comparisonId) &&
    (
      routeKey === 'documentcomparisondetail' ||
      workflowType === 'document_comparison' ||
      entityType === 'document_comparison' ||
      Boolean(actionComparisonTarget) ||
      eventType === 'evaluation_update'
    );

  if (isCanonicalDocumentComparisonTarget) {
    const tab = metadata.tab || actionComparisonTarget?.tab || 'report';
    const href = buildDocumentComparisonDetailHref({ comparisonId, tab });
    const legacyHref =
      metadata.legacyActionUrl ||
      buildLegacyOpportunityNotificationHref({ actionUrl, proposalId });

    return {
      href: href || legacyHref || fallbackHref,
      route: 'DocumentComparisonDetail',
      tab,
      workflow_type: workflowType || 'document_comparison',
      entity_type: entityType || 'document_comparison',
      comparison_id: comparisonId,
      proposal_id: proposalId || null,
      is_legacy_fallback: !href,
      legacy_href: legacyHref || null,
    };
  }

  const legacyHref =
    metadata.legacyActionUrl ||
    buildLegacyOpportunityNotificationHref({ actionUrl, proposalId });

  return {
    href: legacyHref || fallbackHref,
    route: null,
    tab: null,
    workflow_type: workflowType || null,
    entity_type: entityType || null,
    comparison_id: comparisonId || null,
    proposal_id: proposalId || null,
    is_legacy_fallback: Boolean(legacyHref),
    legacy_href: legacyHref || null,
  };
}
