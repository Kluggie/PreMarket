import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstValidString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return null;
}

function readSnapshotId(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  const data = toObject(row?.data);
  const details = toObject(row?.details);
  return firstValidString(
    row?.snapshot_id,
    row?.snapshotId,
    data?.snapshot_id,
    data?.snapshotId,
    details?.snapshot_id,
    details?.snapshotId
  );
}

function readToken(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  const data = toObject(row?.data);
  const details = toObject(row?.details);
  return firstValidString(row?.token, data?.token, details?.token);
}

Deno.serve(async (req) => {
  const correlationId = `snapshot_access_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user?.id) {
      return Response.json({
        ok: true,
        ensured: false,
        skipped: true,
        reason: 'AUTH_REQUIRED',
        correlationId
      });
    }

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const token = asString(body?.token) || asString(new URL(req.url).searchParams.get('token'));
    let snapshotId = asString(body?.snapshotId || body?.snapshot_id || new URL(req.url).searchParams.get('snapshotId'));

    if (!snapshotId && token) {
      const validation = await validateShareLinkAccess(base44, { token, consumeView: false });
      if (validation.ok) {
        snapshotId = asString(validation.shareLink.snapshotId);
      }
    }

    if (!snapshotId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_SNAPSHOT_ID',
        message: 'snapshotId is required',
        correlationId
      }, { status: 400 });
    }

    const snapshotRows = await Promise.all([
      base44.asServiceRole.entities.ProposalSnapshot.filter({ id: snapshotId }, '-created_date', 1).catch(() => []),
      base44.asServiceRole.entities.ProposalSnapshot.filter({ snapshot_id: snapshotId }, '-created_date', 1).catch(() => [])
    ]);
    const snapshot = [...snapshotRows[0], ...snapshotRows[1]]?.[0] || null;

    if (!snapshot) {
      return Response.json({
        ok: false,
        errorCode: 'SNAPSHOT_NOT_FOUND',
        message: 'Snapshot not found',
        correlationId
      }, { status: 404 });
    }

    const snapshotData = toObject(snapshot?.snapshotData || snapshot?.snapshot_data || snapshot?.data?.snapshotData || snapshot?.data?.snapshot_data);
    const snapshotMeta = toObject(snapshot?.snapshotMeta || snapshot?.snapshot_meta || snapshot?.data?.snapshotMeta || snapshot?.data?.snapshot_meta);

    const sourceProposalId = firstValidString(
      snapshot?.sourceProposalId,
      snapshot?.source_proposal_id,
      snapshotData?.proposal?.sourceProposalId,
      snapshotMeta?.sourceProposalId
    );
    const version = Number(
      snapshot?.version ??
      snapshot?.snapshot_version ??
      snapshot?.snapshotVersion ??
      snapshotMeta?.version ??
      1
    );

    const existingRows = await Promise.all([
      base44.asServiceRole.entities.SnapshotAccess.filter({ user_id: user.id, snapshot_id: snapshotId }, '-created_date', 10).catch(() => []),
      base44.asServiceRole.entities.SnapshotAccess.filter({ userId: user.id, snapshotId }, '-created_date', 10).catch(() => []),
      base44.asServiceRole.entities.SnapshotAccess.filter({ user_id: user.id, snapshotId }, '-created_date', 10).catch(() => []),
      base44.asServiceRole.entities.SnapshotAccess.filter({ userId: user.id, snapshot_id: snapshotId }, '-created_date', 10).catch(() => [])
    ]);
    const existing = existingRows.flat().find((row: any) => readSnapshotId(row) === snapshotId) || null;

    const now = new Date().toISOString();
    const firstOpenedAt = firstValidString(
      existing?.firstOpenedAt,
      existing?.first_opened_at,
      existing?.created_date,
      now
    ) || now;

    const payload = {
      snapshotId,
      snapshot_id: snapshotId,
      userId: user.id,
      user_id: user.id,
      sourceProposalId,
      source_proposal_id: sourceProposalId,
      version: Number.isFinite(version) ? version : 1,
      firstOpenedAt,
      first_opened_at: firstOpenedAt,
      lastOpenedAt: now,
      last_opened_at: now,
      token: token || readToken(existing)
    };

    if (existing?.id) {
      await base44.asServiceRole.entities.SnapshotAccess.update(existing.id, payload);
      console.log('[ensureSnapshotAccess] exists', JSON.stringify({ snapshotId, userId: user.id }));
      return Response.json({
        ok: true,
        ensured: true,
        created: false,
        snapshotId,
        sourceProposalId,
        version: Number.isFinite(version) ? version : 1,
        recordId: asString(existing.id),
        lastOpenedAt: now,
        correlationId
      });
    }

    const created = await base44.asServiceRole.entities.SnapshotAccess.create(payload);
    console.log('[ensureSnapshotAccess] created', JSON.stringify({ snapshotId, userId: user.id }));

    return Response.json({
      ok: true,
      ensured: true,
      created: true,
      snapshotId,
      sourceProposalId,
      version: Number.isFinite(version) ? version : 1,
      recordId: asString(created?.id),
      firstOpenedAt,
      lastOpenedAt: now,
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to ensure snapshot access',
      correlationId
    }, { status: 500 });
  }
});
