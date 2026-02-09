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
  const maxViews = toNumber(shareLink?.max_uses ?? shareLink?.max_views, DEFAULT_MAX_VIEWS);
  const viewCount = toNumber(shareLink?.uses ?? shareLink?.view_count, 0);
  const mode =
    asString(shareLink?.share_mode || shareLink?.mode || shareLink?.access_mode) ||
    (buildPermissions(shareLink).canEdit ? 'interactive' : 'view_only');

  return {
    id: asString(shareLink?.id) || '',
    token: asString(shareLink?.token),
    proposalId: asString(shareLink?.proposal_id ?? shareLink?.proposalId),
    evaluationItemId: asString(shareLink?.evaluation_item_id ?? shareLink?.evaluationItemId),
    documentComparisonId: asString(shareLink?.document_comparison_id ?? shareLink?.documentComparisonId),
    recipientEmail: normalizeEmail(shareLink?.recipient_email ?? shareLink?.recipientEmail),
    status: asString(shareLink?.status),
    mode,
    createdAt: asString(shareLink?.created_date ?? shareLink?.createdAt),
    expiresAt: asString(shareLink?.expires_at ?? shareLink?.expiresAt),
    viewCount,
    maxViews,
    lastUsedAt: asString(shareLink?.last_used_at ?? shareLink?.lastUsedAt)
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

  if (shareLink.viewCount >= shareLink.maxViews) {
    return errorResult(410, 'MAX_VIEWS_REACHED', 'This share link has reached the maximum number of views', currentUserEmail, false, shareLink);
  }

  const expectedRecipient = normalizeEmail(shareLink.recipientEmail);
  const matchedRecipient = !expectedRecipient || !currentUserEmail || expectedRecipient === currentUserEmail;

  if (expectedRecipient && !currentUserEmail) {
    return errorResult(401, 'AUTH_REQUIRED', 'Please sign in to continue', currentUserEmail, false, shareLink);
  }

  if (expectedRecipient && currentUserEmail && expectedRecipient !== currentUserEmail) {
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
