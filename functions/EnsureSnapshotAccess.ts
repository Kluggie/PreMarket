import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value);
  return raw ? raw.toLowerCase() : null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseDetailsField(value: unknown): Record<string, unknown> {
  return toObject(value);
}

function extractSnapshotIdFromAccess(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  const details = parseDetailsField(row?.details);
  return asString(
    row?.snapshot_id ||
    row?.snapshotId ||
    details?.snapshot_id ||
    details?.snapshotId ||
    null
  );
}

Deno.serve(async (req) => {
  const correlationId = `access_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId
      }, { status: 401 });
    }

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const snapshotId = asString(body?.snapshotId || body?.snapshot_id);
    const token = asString(body?.token);
    const userId = asString(user?.id);
    const userEmail = normalizeEmail(user?.email);

    if (!snapshotId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_SNAPSHOT_ID',
        message: 'snapshotId is required',
        correlationId
      }, { status: 400 });
    }

    if (!userId || !userEmail) {
      return Response.json({
        ok: false,
        errorCode: 'USER_DATA_MISSING',
        message: 'User ID and email are required',
        correlationId
      }, { status: 400 });
    }

    // Check if access record already exists
    const existingRows = await base44.asServiceRole.entities.SnapshotAccess
      .filter({ user_id: userId }, '-created_date', 200)
      .catch(() => []);

    const existingRecord = existingRows.find((row: any) => {
      return extractSnapshotIdFromAccess(row) === snapshotId;
    }) || null;

    const now = new Date().toISOString();

    if (existingRecord?.id) {
      // Update last accessed time and increment count
      const currentCount = Number(existingRecord?.access_count || 0);
      await base44.asServiceRole.entities.SnapshotAccess.update(existingRecord.id, {
        last_opened_at: now,
        lastOpenedAt: now,
        access_count: currentCount + 1,
        accessCount: currentCount + 1
      });

      console.log('[EnsureSnapshotAccess] updated', JSON.stringify({
        snapshotId,
        userId,
        accessId: existingRecord.id
      }));

      return Response.json({
        ok: true,
        created: false,
        accessId: existingRecord.id,
        snapshotId,
        userId,
        correlationId
      });
    }

    // Create new access record
    const created = await base44.asServiceRole.entities.SnapshotAccess.create({
      snapshot_id: snapshotId,
      snapshotId: snapshotId,
      user_id: userId,
      userId: userId,
      user_email: userEmail,
      userEmail: userEmail,
      first_opened_at: now,
      firstOpenedAt: now,
      last_opened_at: now,
      lastOpenedAt: now,
      access_count: 1,
      accessCount: 1
    });

    console.log('[EnsureSnapshotAccess] created', JSON.stringify({
      snapshotId,
      userId,
      accessId: created?.id
    }));

    return Response.json({
      ok: true,
      created: true,
      accessId: asString(created?.id),
      snapshotId,
      userId,
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] EnsureSnapshotAccess error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to ensure snapshot access',
      correlationId
    }, { status: 500 });
  }
});