type PermissionSet = {
  canView: boolean;
  canEdit: boolean;
  canEditRecipientSide: boolean;
  canReevaluate: boolean;
  canSendBack: boolean;
};

type ShareLinkView = {
  id: string;
  token: string | null;
  proposalId: string | null;
  sourceProposalId: string | null;
  snapshotId: string | null;
  snapshotVersion: number | null;
  evaluationItemId: string | null;
  documentComparisonId: string | null;
  recipientEmail: string | null;
  status: string | null;
  mode: string;
  createdAt: string | null;
  expiresAt: string | null;
  viewCount: number;
  maxViews: number;
  lastUsedAt: string | null;
};

type ValidateResult =
  | {
      ok: true;
      statusCode: 200;
      code: 'OK';
      reason: 'OK';
      message: string;
      shareLink: ShareLinkView;
      permissions: PermissionSet;
      matchedRecipient: boolean;
      currentUserEmail: string | null;
      consumedView: boolean;
    }
  | {
      ok: false;
      statusCode: number;
      code: string;
      reason: string;
      message: string;
      shareLink?: ShareLinkView | null;
      permissions?: PermissionSet;
      matchedRecipient: boolean;
      currentUserEmail: string | null;
      consumedView: false;
    };

const RECIPIENT_KEYS = new Set(['b', 'party_b', 'recipient', 'counterparty', 'buyer', 'requirements_owner']);
const ACTIVE_STATUS = 'active';
const DEFAULT_MAX_VIEWS = 25;
const VIEW_DEDUPE_WINDOW_MS = 15000;

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeEmail = (value: unknown): string | null => {
  const raw = asString(value);
  return raw ? raw.toLowerCase() : null;
};

const toNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
};

const pickString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const next = asString(value);
    if (next) return next;
  }
  return null;
};

const pickNumber = (fallback: number, ...values: unknown[]): number => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
};

const parsePermissionOverrides = (raw: unknown): Partial<PermissionSet> | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed as Partial<PermissionSet> : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as Partial<PermissionSet>;
  }
  return null;
};

const buildPermissions = (shareLink: any): PermissionSet => {
  const mode = asString(
    shareLink?.share_mode ||
    shareLink?.mode ||
    shareLink?.access_mode ||
    null
  ) || 'interactive';

  const defaults: PermissionSet = mode === 'view_only'
    ? {
        canView: true,
        canEdit: false,
        canEditRecipientSide: false,
        canReevaluate: false,
        canSendBack: false
      }
    : {
        canView: true,
        canEdit: true,
        canEditRecipientSide: true,
        canReevaluate: true,
        canSendBack: true
      };

  const override = parsePermissionOverrides(
    shareLink?.permissions_json ||
    shareLink?.permissions ||
    shareLink?.policy_json ||
    null
  );

  if (!override) return defaults;

  return {
    canView: override.canView ?? defaults.canView,
    canEdit: override.canEdit ?? override.canEditRecipientSide ?? defaults.canEdit,
    canEditRecipientSide: override.canEditRecipientSide ?? override.canEdit ?? defaults.canEditRecipientSide,
    canReevaluate: override.canReevaluate ?? defaults.canReevaluate,
    canSendBack: override.canSendBack ?? defaults.canSendBack
  };
};

const mapShareLink = (shareLink: any): ShareLinkView => {
  const data = toObject(shareLink?.data);
  const context = toObject(shareLink?.context);
  const metadata = toObject(shareLink?.metadata);

  const maxViews = pickNumber(
    DEFAULT_MAX_VIEWS,
    shareLink?.max_uses,
    shareLink?.max_views,
    shareLink?.maxUses,
    shareLink?.maxViews,
    data.max_uses,
    data.max_views,
    data.maxUses,
    data.maxViews,
    context.max_uses,
    context.max_views,
    context.maxUses,
    context.maxViews,
    metadata.max_uses,
    metadata.max_views,
    metadata.maxUses,
    metadata.maxViews
  );
  const viewCount = pickNumber(
    0,
    shareLink?.uses,
    shareLink?.view_count,
    shareLink?.viewCount,
    data.uses,
    data.view_count,
    data.viewCount,
    context.uses,
    context.view_count,
    context.viewCount,
    metadata.uses,
    metadata.view_count,
    metadata.viewCount
  );
  const mode =
    asString(shareLink?.share_mode || shareLink?.mode || shareLink?.access_mode) ||
    (buildPermissions(shareLink).canEdit ? 'interactive' : 'view_only');
  const snapshotVersionCandidates = [
    shareLink?.snapshot_version,
    shareLink?.snapshotVersion,
    shareLink?.version,
    data.snapshot_version,
    data.snapshotVersion,
    data.version,
    context.snapshot_version,
    context.snapshotVersion,
    context.version,
    metadata.snapshot_version,
    metadata.snapshotVersion,
    metadata.version
  ];
  let snapshotVersion: number | null = null;
  for (const candidate of snapshotVersionCandidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      snapshotVersion = Math.floor(numeric);
      break;
    }
  }

  return {
    id: asString(shareLink?.id) || '',
    token: pickString(
      shareLink?.token,
      data.token,
      context.token,
      metadata.token
    ),
    sourceProposalId: pickString(
      shareLink?.source_proposal_id,
      shareLink?.sourceProposalId,
      data.source_proposal_id,
      data.sourceProposalId,
      context.source_proposal_id,
      context.sourceProposalId,
      metadata.source_proposal_id,
      metadata.sourceProposalId
    ),
    snapshotId: pickString(
      shareLink?.snapshot_id,
      shareLink?.snapshotId,
      data.snapshot_id,
      data.snapshotId,
      context.snapshot_id,
      context.snapshotId,
      metadata.snapshot_id,
      metadata.snapshotId
    ),
    snapshotVersion,
    proposalId: pickString(
      shareLink?.proposal_id,
      shareLink?.proposalId,
      shareLink?.linked_proposal_id,
      shareLink?.linkedProposalId,
      data.proposal_id,
      data.proposalId,
      data.linked_proposal_id,
      data.linkedProposalId,
      context.proposal_id,
      context.proposalId,
      context.linked_proposal_id,
      context.linkedProposalId,
      metadata.proposal_id,
      metadata.proposalId,
      metadata.linked_proposal_id,
      metadata.linkedProposalId
    ) || pickString(
      shareLink?.source_proposal_id,
      shareLink?.sourceProposalId,
      data.source_proposal_id,
      data.sourceProposalId,
      context.source_proposal_id,
      context.sourceProposalId,
      metadata.source_proposal_id,
      metadata.sourceProposalId
    ),
    evaluationItemId: pickString(
      shareLink?.evaluation_item_id,
      shareLink?.evaluationItemId,
      shareLink?.evaluation_itemId,
      shareLink?.linked_evaluation_item_id,
      shareLink?.linkedEvaluationItemId,
      data.evaluation_item_id,
      data.evaluationItemId,
      data.evaluation_itemId,
      data.linked_evaluation_item_id,
      data.linkedEvaluationItemId,
      context.evaluation_item_id,
      context.evaluationItemId,
      context.evaluation_itemId,
      context.linked_evaluation_item_id,
      context.linkedEvaluationItemId,
      metadata.evaluation_item_id,
      metadata.evaluationItemId,
      metadata.evaluation_itemId,
      metadata.linked_evaluation_item_id,
      metadata.linkedEvaluationItemId
    ),
    documentComparisonId: pickString(
      shareLink?.document_comparison_id,
      shareLink?.documentComparisonId,
      shareLink?.linked_document_comparison_id,
      shareLink?.linkedDocumentComparisonId,
      data.document_comparison_id,
      data.documentComparisonId,
      data.linked_document_comparison_id,
      data.linkedDocumentComparisonId,
      context.document_comparison_id,
      context.documentComparisonId,
      context.linked_document_comparison_id,
      context.linkedDocumentComparisonId,
      metadata.document_comparison_id,
      metadata.documentComparisonId,
      metadata.linked_document_comparison_id,
      metadata.linkedDocumentComparisonId
    ),
    recipientEmail: normalizeEmail(
      pickString(
        shareLink?.recipient_email,
        shareLink?.recipientEmail,
        data.recipient_email,
        data.recipientEmail,
        context.recipient_email,
        context.recipientEmail,
        metadata.recipient_email,
        metadata.recipientEmail
      )
    ),
    status: pickString(
      shareLink?.status,
      data.status,
      context.status,
      metadata.status
    ),
    mode,
    createdAt: pickString(
      shareLink?.created_date,
      shareLink?.createdAt,
      data.created_date,
      data.createdAt,
      context.created_date,
      context.createdAt,
      metadata.created_date,
      metadata.createdAt
    ),
    expiresAt: pickString(
      shareLink?.expires_at,
      shareLink?.expiresAt,
      data.expires_at,
      data.expiresAt,
      context.expires_at,
      context.expiresAt,
      metadata.expires_at,
      metadata.expiresAt
    ),
    viewCount,
    maxViews,
    lastUsedAt: pickString(
      shareLink?.last_used_at,
      shareLink?.lastUsedAt,
      data.last_used_at,
      data.lastUsedAt,
      context.last_used_at,
      context.lastUsedAt,
      metadata.last_used_at,
      metadata.lastUsedAt
    )
  };
};

const errorResult = (
  statusCode: number,
  code: string,
  message: string,
  currentUserEmail: string | null,
  matchedRecipient: boolean,
  shareLink: ShareLinkView | null = null
): ValidateResult => ({
  ok: false,
  statusCode,
  code,
  reason: code,
  message,
  shareLink,
  matchedRecipient,
  currentUserEmail,
  consumedView: false
});

async function tryGetCurrentUser(base44: any) {
  try {
    const user = await base44.auth.me();
    return user || null;
  } catch {
    return null;
  }
}

async function tryGetProposalRecipientEmail(base44: any, proposalId: string | null): Promise<string | null> {
  const normalizedProposalId = asString(proposalId);
  if (!normalizedProposalId) return null;

  try {
    const rows = await base44.asServiceRole.entities.Proposal.filter({ id: normalizedProposalId }, '-created_date', 1);
    const proposal = rows?.[0] || null;
    if (!proposal || typeof proposal !== 'object') return null;

    const data = toObject((proposal as any)?.data);
    return normalizeEmail(
      (proposal as any)?.party_b_email ||
      (proposal as any)?.partyBEmail ||
      data.party_b_email ||
      data.partyBEmail ||
      null
    );
  } catch {
    return null;
  }
}

const shouldTreatAsRecipientQuestion = (question: any): boolean => {
  const normalizedParty = String(
    question?.party ||
    question?.party_key ||
    question?.subject_party ||
    question?.for_party ||
    ''
  ).toLowerCase();

  if (RECIPIENT_KEYS.has(normalizedParty) || normalizedParty === 'both') {
    return true;
  }

  const roleType = String(question?.role_type || '').toLowerCase();
  if (roleType === 'shared_fact') return false;
  if (roleType === 'counterparty_observation') return true;

  return Boolean(question?.is_about_counterparty);
};

const dedupeViewIncrement = (shareLink: ShareLinkView): boolean => {
  if (!shareLink.lastUsedAt) return false;
  const lastUsed = new Date(shareLink.lastUsedAt).getTime();
  if (!Number.isFinite(lastUsed)) return false;
  return (Date.now() - lastUsed) <= VIEW_DEDUPE_WINDOW_MS;
};

export async function validateShareLinkAccess(
  base44: any,
  {
    token,
    consumeView = true
  }: {
    token: string | null;
    consumeView?: boolean;
  }
): Promise<ValidateResult> {
  if (!token) {
    return errorResult(400, 'MISSING_TOKEN', 'Token is required', null, false);
  }

  const currentUser = await tryGetCurrentUser(base44);
  const currentUserEmail = normalizeEmail(currentUser?.email);

  const rows = await base44.asServiceRole.entities.ShareLink.filter({ token }, '-created_date', 1);
  const rawShareLink = rows?.[0] || null;

  if (!rawShareLink) {
    return errorResult(404, 'TOKEN_NOT_FOUND', 'Share link not found', currentUserEmail, false);
  }

  let shareLink = mapShareLink(rawShareLink);
  const permissions = buildPermissions(rawShareLink);

  if (!permissions.canView) {
    return errorResult(403, 'VIEW_NOT_ALLOWED', 'Viewing is not allowed for this token', currentUserEmail, false, shareLink);
  }

  if (shareLink.status !== ACTIVE_STATUS) {
    return errorResult(403, 'TOKEN_INACTIVE', 'This share link is not active', currentUserEmail, false, shareLink);
  }

  if (shareLink.expiresAt && new Date(shareLink.expiresAt).getTime() < Date.now()) {
    return errorResult(410, 'TOKEN_EXPIRED', 'This share link has expired', currentUserEmail, false, shareLink);
  }

  const isSharedReportMode = String(shareLink.mode || '').toLowerCase() === 'shared_report';
  const enforceViewLimit = !isSharedReportMode && shareLink.maxViews > 0;
  if (enforceViewLimit && shareLink.viewCount >= shareLink.maxViews) {
    return errorResult(410, 'MAX_VIEWS_REACHED', 'This share link has reached the maximum number of views', currentUserEmail, false, shareLink);
  }

  let expectedRecipient = normalizeEmail(shareLink.recipientEmail);
  if (!expectedRecipient) {
    expectedRecipient = await tryGetProposalRecipientEmail(
      base44,
      shareLink.sourceProposalId || shareLink.proposalId
    );
  }
  const matchedRecipient = Boolean(expectedRecipient && currentUserEmail && expectedRecipient === currentUserEmail);

  if (!expectedRecipient) {
    return errorResult(
      403,
      'RECIPIENT_REQUIRED',
      'This share link is missing a recipient restriction. Ask the sender to share the report again.',
      currentUserEmail,
      false,
      shareLink
    );
  }

  if (!currentUserEmail) {
    return errorResult(401, 'AUTH_REQUIRED', 'Please sign in to continue', currentUserEmail, false, shareLink);
  }

  if (expectedRecipient !== currentUserEmail) {
    return errorResult(403, 'RECIPIENT_MISMATCH', 'This link was issued for a different recipient account', currentUserEmail, false, shareLink);
  }

  let consumedView = false;
  if (consumeView) {
    const shouldSkipIncrement = dedupeViewIncrement(shareLink);
    if (!shouldSkipIncrement) {
      const nextViews = shareLink.viewCount + 1;
      await base44.asServiceRole.entities.ShareLink.update(shareLink.id, {
        uses: nextViews,
        last_used_at: new Date().toISOString()
      });
      shareLink = {
        ...shareLink,
        viewCount: nextViews,
        lastUsedAt: new Date().toISOString()
      };
      consumedView = true;
    }
  }

  return {
    ok: true,
    statusCode: 200,
    code: 'OK',
    reason: 'OK',
    message: 'Share link resolved',
    shareLink,
    permissions,
    matchedRecipient,
    currentUserEmail,
    consumedView
  };
}

export function toRecipientEditableQuestionIds(template: any): string[] {
  const questions = Array.isArray(template?.questions) ? template.questions : [];
  return questions
    .filter((question: any) => {
      const roleType = String(question?.role_type || '').toLowerCase();
      if (roleType === 'shared_fact') return false;
      return shouldTreatAsRecipientQuestion(question);
    })
    .map((question: any) => String(question?.id || '').trim())
    .filter(Boolean);
}

export function toQuestionLookup(template: any): Record<string, any> {
  const questions = Array.isArray(template?.questions) ? template.questions : [];
  const lookup: Record<string, any> = {};
  for (const question of questions) {
    const questionId = String(question?.id || '').trim();
    if (questionId) {
      lookup[questionId] = question;
    }
  }
  return lookup;
}
