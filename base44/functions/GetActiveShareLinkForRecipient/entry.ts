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

function extractSourceProposalId(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const context = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  const metadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};

  return (
    asString(shareLink.source_proposal_id) ||
    asString(shareLink.sourceProposalId) ||
    asString(context.source_proposal_id) ||
    asString(context.sourceProposalId) ||
    asString(data.source_proposal_id) ||
    asString(data.sourceProposalId) ||
    asString(metadata.source_proposal_id) ||
    asString(metadata.sourceProposalId) ||
    extractProposalId(shareLink) ||
    null
  );
}

function extractSnapshotId(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const context = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  const metadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};

  return (
    asString(shareLink.snapshot_id) ||
    asString(shareLink.snapshotId) ||
    asString(context.snapshot_id) ||
    asString(context.snapshotId) ||
    asString(data.snapshot_id) ||
    asString(data.snapshotId) ||
    asString(metadata.snapshot_id) ||
    asString(metadata.snapshotId) ||
    null
  );
}

function extractSnapshotVersion(shareLink: any): number | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const context = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  const metadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};

  const version = toNumber(
    shareLink.snapshot_version ??
    shareLink.snapshotVersion ??
    shareLink.version ??
    context.snapshot_version ??
    context.snapshotVersion ??
    context.version ??
    data.snapshot_version ??
    data.snapshotVersion ??
    data.version ??
    metadata.snapshot_version ??
    metadata.snapshotVersion ??
    metadata.version,
    -1
  );

  return version >= 0 ? version : null;
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
    const requestedRecipientEmail = normalizeEmail(body?.recipientEmail || body?.recipient_email || null);

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

    const proposalRows = await base44.asServiceRole.entities.Proposal.filter({ id: proposalId }, '-created_date', 1);
    const proposal = proposalRows?.[0] || null;
    if (!proposal) {
      return respond({
        ok: false,
        errorCode: 'PROPOSAL_NOT_FOUND',
        message: 'Proposal not found',
        correlationId
      }, 404);
    }

    const proposalRecipientEmail = normalizeEmail(
      proposal?.party_b_email ||
      proposal?.partyBEmail ||
      proposal?.data?.party_b_email ||
      proposal?.data?.partyBEmail ||
      null
    );
    const proposalOwnerEmail = normalizeEmail(proposal?.party_a_email || proposal?.data?.party_a_email || null);
    const proposalOwnerUserId = asString(proposal?.party_a_user_id || proposal?.created_by_user_id || null);
    const currentUserId = asString(user?.id);
    const isOwner =
      Boolean(currentUserId && proposalOwnerUserId && currentUserId === proposalOwnerUserId) ||
      Boolean(currentUserEmail && proposalOwnerEmail && currentUserEmail === proposalOwnerEmail);

    const targetRecipientEmail = isOwner
      ? (requestedRecipientEmail || proposalRecipientEmail)
      : currentUserEmail;

    if (!targetRecipientEmail) {
      return respond({
        ok: false,
        errorCode: 'RECIPIENT_EMAIL_MISSING',
        message: 'Recipient email is required to resolve the active shared link',
        correlationId
      }, 400);
    }

    if (!isOwner && proposalRecipientEmail && proposalRecipientEmail !== currentUserEmail) {
      return respond({
        ok: false,
        errorCode: 'FORBIDDEN',
        message: 'Only the intended recipient can resolve this shared link',
        correlationId
      }, 403);
    }

    const [rowsBySnakeEmail, rowsByCamelEmail, rowsBySnakeProposal, rowsByCamelProposal, rowsBySourceSnake, rowsBySourceCamel] = await Promise.all([
      base44.asServiceRole.entities.ShareLink.filter({ recipient_email: targetRecipientEmail }, '-created_date', 200),
      base44.asServiceRole.entities.ShareLink.filter({ recipientEmail: targetRecipientEmail }, '-created_date', 200),
      base44.asServiceRole.entities.ShareLink.filter({ proposal_id: proposalId }, '-created_date', 200),
      base44.asServiceRole.entities.ShareLink.filter({ proposalId }, '-created_date', 200),
      base44.asServiceRole.entities.ShareLink.filter({ source_proposal_id: proposalId }, '-created_date', 200).catch(() => []),
      base44.asServiceRole.entities.ShareLink.filter({ sourceProposalId: proposalId }, '-created_date', 200).catch(() => [])
    ]);

    const allRows: any[] = [];
    const seenIds = new Set<string>();
    for (const row of [
      ...(rowsBySnakeEmail || []),
      ...(rowsByCamelEmail || []),
      ...(rowsBySnakeProposal || []),
      ...(rowsByCamelProposal || []),
      ...(rowsBySourceSnake || []),
      ...(rowsBySourceCamel || [])
    ]) {
      const rowId = asString((row as any)?.id);
      if (rowId && seenIds.has(rowId)) continue;
      if (rowId) seenIds.add(rowId);
      allRows.push(row);
    }

    const matchingProposalRows = allRows.filter((row) => {
      const sourceProposalId = extractSourceProposalId(row);
      if (sourceProposalId !== proposalId) return false;
      const rowRecipient = extractRecipientEmail(row);
      if (rowRecipient) {
        return rowRecipient === targetRecipientEmail;
      }
      return proposalRecipientEmail ? proposalRecipientEmail === targetRecipientEmail : true;
    });

    const activeRows = matchingProposalRows
      .filter((row) => extractStatus(row) === ACTIVE_STATUS)
      .sort((a, b) => {
        const versionA = extractSnapshotVersion(a) ?? 0;
        const versionB = extractSnapshotVersion(b) ?? 0;
        if (versionA !== versionB) {
          return versionB - versionA;
        }
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

    const snapshotId = extractSnapshotId(latestActive);
    const snapshotVersion = extractSnapshotVersion(latestActive);
    const sourceProposalId = extractSourceProposalId(latestActive) || proposalId;

    return respond({
      ok: true,
      proposalId: sourceProposalId,
      sourceProposalId,
      token,
      shareUrl,
      shareLinkId: asString((latestActive as any)?.id),
      snapshotId,
      version: snapshotVersion,
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
