import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { buildSharedReportUrl, SHARE_REPORT_PATH } from './_utils/shareUrl.ts';

const ACTIVE_STATUS = 'active';
const DEFAULT_MAX_VIEWS = 25;
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

function respond(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: NO_CACHE_HEADERS
  });
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value);
  return raw ? raw.toLowerCase() : null;
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function extractProposalId(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const context = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  const metadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};

  return (
    asString(shareLink.proposal_id) ||
    asString(shareLink.proposalId) ||
    asString(shareLink.linked_proposal_id) ||
    asString(shareLink.linkedProposalId) ||
    asString(context.proposal_id) ||
    asString(context.proposalId) ||
    asString(context.linked_proposal_id) ||
    asString(context.linkedProposalId) ||
    asString(data.proposal_id) ||
    asString(data.proposalId) ||
    asString(data.linked_proposal_id) ||
    asString(data.linkedProposalId) ||
    asString(metadata.proposal_id) ||
    asString(metadata.proposalId) ||
    asString(metadata.linked_proposal_id) ||
    asString(metadata.linkedProposalId) ||
    null
  );
}

function extractRecipientEmail(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  const context = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
  const metadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};
  return normalizeEmail(
    shareLink.recipient_email ||
    shareLink.recipientEmail ||
    data.recipient_email ||
    data.recipientEmail ||
    context.recipient_email ||
    context.recipientEmail ||
    metadata.recipient_email ||
    metadata.recipientEmail ||
    null
  );
}

function extractCreatedAt(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  return asString(
    shareLink.created_date ||
    shareLink.createdAt ||
    data.created_date ||
    data.createdAt ||
    null
  );
}

function extractExpiresAt(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  return asString(
    shareLink.expires_at ||
    shareLink.expiresAt ||
    data.expires_at ||
    data.expiresAt ||
    null
  );
}

function extractStatus(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;
  return asString(shareLink.status)?.toLowerCase() || null;
}

function extractToken(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;
  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  return asString(shareLink.token || data.token || null);
}

function extractViewCount(shareLink: any): number {
  return toNumber(shareLink?.uses ?? shareLink?.view_count, 0);
}

function extractMaxViews(shareLink: any): number {
  const value = toNumber(shareLink?.max_uses ?? shareLink?.max_views, DEFAULT_MAX_VIEWS);
  return value > 0 ? value : DEFAULT_MAX_VIEWS;
}

Deno.serve(async (req) => {
  const correlationId = `active_share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return respond({
        ok: false,
        errorCode: 'AUTH_REQUIRED',
        message: 'Authentication required',
        correlationId
      }, 401);
    }

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const proposalId = asString(body?.proposalId || body?.proposal_id);

    if (!proposalId) {
      return respond({
        ok: false,
        errorCode: 'MISSING_PROPOSAL_ID',
        message: 'proposalId is required',
        correlationId
      }, 400);
    }

    const currentUserEmail = normalizeEmail(user?.email);
    if (!currentUserEmail) {
      return respond({
        ok: false,
        errorCode: 'MISSING_USER_EMAIL',
        message: 'Signed-in user email is required',
        correlationId
      }, 400);
    }

    const [rowsBySnakeEmail, rowsByCamelEmail, rowsBySnakeProposal, rowsByCamelProposal] = await Promise.all([
      base44.asServiceRole.entities.ShareLink.filter({ recipient_email: currentUserEmail }, '-created_date', 100),
      base44.asServiceRole.entities.ShareLink.filter({ recipientEmail: currentUserEmail }, '-created_date', 100),
      base44.asServiceRole.entities.ShareLink.filter({ proposal_id: proposalId }, '-created_date', 100),
      base44.asServiceRole.entities.ShareLink.filter({ proposalId }, '-created_date', 100)
    ]);

    const allRows: any[] = [];
    const seenIds = new Set<string>();
    for (const row of [
      ...(rowsBySnakeEmail || []),
      ...(rowsByCamelEmail || []),
      ...(rowsBySnakeProposal || []),
      ...(rowsByCamelProposal || [])
    ]) {
      const rowId = asString((row as any)?.id);
      if (rowId && seenIds.has(rowId)) continue;
      if (rowId) seenIds.add(rowId);
      allRows.push(row);
    }

    const matchingProposalRows = allRows.filter((row) => {
      return extractProposalId(row) === proposalId && extractRecipientEmail(row) === currentUserEmail;
    });

    const activeRows = matchingProposalRows
      .filter((row) => extractStatus(row) === ACTIVE_STATUS)
      .sort((a, b) => {
        const dateA = new Date(extractCreatedAt(a) || 0).getTime();
        const dateB = new Date(extractCreatedAt(b) || 0).getTime();
        return dateB - dateA;
      });

    const latestActive = activeRows[0];
    if (!latestActive) {
      return respond({
        ok: false,
        errorCode: 'NO_ACTIVE_SHARE_LINK',
        message: 'No shared workspace link found. Ask the sender to share again.',
        correlationId
      }, 404);
    }

    const expiresAt = extractExpiresAt(latestActive);
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return respond({
        ok: false,
        errorCode: 'TOKEN_EXPIRED',
        message: 'The latest shared workspace link has expired. Ask for a new link.',
        correlationId
      }, 410);
    }

    const viewCount = extractViewCount(latestActive);
    const maxViews = extractMaxViews(latestActive);
    if (viewCount >= maxViews) {
      return respond({
        ok: false,
        errorCode: 'MAX_VIEWS_REACHED',
        message: 'The latest shared workspace link has reached its view limit.',
        correlationId
      }, 410);
    }

    const token = extractToken(latestActive);
    if (!token) {
      return respond({
        ok: false,
        errorCode: 'TOKEN_NOT_FOUND',
        message: 'The latest shared workspace link is missing a token.',
        correlationId
      }, 404);
    }

    let shareUrl: string;
    try {
      shareUrl = buildSharedReportUrl(token);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn(`[${correlationId}] Falling back to canonical share URL`, err.message);
      shareUrl = `https://getpremarket.com${SHARE_REPORT_PATH}?token=${encodeURIComponent(token)}`;
    }

    return respond({
      ok: true,
      proposalId,
      token,
      shareUrl,
      shareLinkId: asString((latestActive as any)?.id),
      expiresAt,
      viewCount,
      maxViews,
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] Unexpected error`, err.message);
    return respond({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to resolve active shared workspace link',
      correlationId
    }, 500);
  }
});
