import { desc, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import {
  buildProposalHistoryQueries,
  buildReconstructedDocumentComparisonValues,
  buildReconstructedProposalValues,
} from '../../../_lib/proposal-history.js';
import {
  lookupProposalRecoveryRecords,
  mapRecoveryRecordForResponse,
} from '../../../_lib/proposal-recovery.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { readJsonBody } from '../../../_lib/http.js';

function requireAdmin(auth) {
  if (auth.user.role !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Admin access required');
  }
}

function readLookupFilters(source: Record<string, unknown> = {}) {
  return {
    proposalId: String(source.proposalId || source.proposal_id || '').trim(),
    email: String(source.email || '').trim(),
    userId: String(source.userId || source.user_id || '').trim(),
  };
}

function hasLookupFilters(filters) {
  return Boolean(filters.proposalId || filters.email || filters.userId);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/admin/proposals/recovery', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;
    requireAdmin(auth);

    const db = getDb();

    if (req.method === 'GET') {
      const filters = readLookupFilters(req.query || {});
      if (!hasLookupFilters(filters)) {
        throw new ApiError(400, 'invalid_input', 'proposal_id, email, or user_id is required');
      }

      const results = await lookupProposalRecoveryRecords(db, filters);
      ok(res, 200, {
        results: results.map(mapRecoveryRecordForResponse),
      });
      return;
    }

    const body = await readJsonBody(req);
    const action = String(body.action || '').trim().toLowerCase();
    const proposalId = String(body.proposalId || body.proposal_id || '').trim();
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'proposal_id is required');
    }

    if (action === 'restore_visibility') {
      const [proposal] = await db
        .select()
        .from(schema.proposals)
        .where(eq(schema.proposals.id, proposalId))
        .limit(1);

      if (!proposal) {
        throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
      }

      const now = new Date();
      const explicitFlags = [
        body.restoreDeletedByPartyA,
        body.restoreDeletedByPartyB,
        body.restoreArchivedByPartyA,
        body.restoreArchivedByPartyB,
      ].some((value) => value !== undefined);

      const updateValues = {
        deletedByPartyAAt:
          !explicitFlags || body.restoreDeletedByPartyA ? null : proposal.deletedByPartyAAt || null,
        deletedByPartyBAt:
          !explicitFlags || body.restoreDeletedByPartyB ? null : proposal.deletedByPartyBAt || null,
        archivedByPartyAAt:
          !explicitFlags || body.restoreArchivedByPartyA ? null : proposal.archivedByPartyAAt || null,
        archivedByPartyBAt:
          !explicitFlags || body.restoreArchivedByPartyB ? null : proposal.archivedByPartyBAt || null,
        archivedAt:
          !explicitFlags || body.restoreArchivedByPartyA || body.restoreArchivedByPartyB
            ? null
            : proposal.archivedAt || null,
        updatedAt: now,
      };

      const updatedProposal = {
        ...proposal,
        ...updateValues,
      };
      const { queries: historyQueries } = buildProposalHistoryQueries(db, {
        proposal: updatedProposal,
        actorUserId: auth.user.id,
        actorRole: 'admin',
        milestone: 'restore_visibility',
        eventType: 'proposal.recovered.visibility_restored',
        eventData: {
          cleared_deleted_by_party_a: updateValues.deletedByPartyAAt === null && Boolean(proposal.deletedByPartyAAt),
          cleared_deleted_by_party_b: updateValues.deletedByPartyBAt === null && Boolean(proposal.deletedByPartyBAt),
          cleared_archived_by_party_a:
            updateValues.archivedByPartyAAt === null && Boolean(proposal.archivedByPartyAAt),
          cleared_archived_by_party_b:
            updateValues.archivedByPartyBAt === null && Boolean(proposal.archivedByPartyBAt),
        },
        createdAt: now,
        requestId: context.requestId,
        snapshotMeta: {
          restored_by_admin: true,
        },
      });

      await db.batch([
        db.update(schema.proposals).set(updateValues).where(eq(schema.proposals.id, proposalId)).returning(),
        ...historyQueries,
      ]);

      const results = await lookupProposalRecoveryRecords(db, { proposalId });
      ok(res, 200, {
        restored: true,
        action: 'restore_visibility',
        results: results.map(mapRecoveryRecordForResponse),
      });
      return;
    }

    if (action === 'reconstruct_from_latest_version') {
      const [existingProposal] = await db
        .select({ id: schema.proposals.id })
        .from(schema.proposals)
        .where(eq(schema.proposals.id, proposalId))
        .limit(1);

      if (existingProposal) {
        throw new ApiError(409, 'proposal_already_exists', 'Canonical proposal row already exists');
      }

      const [latestVersion] = await db
        .select()
        .from(schema.proposalVersions)
        .where(eq(schema.proposalVersions.proposalId, proposalId))
        .orderBy(desc(schema.proposalVersions.createdAt))
        .limit(1);

      if (!latestVersion) {
        throw new ApiError(404, 'proposal_version_not_found', 'No recoverable proposal version was found');
      }

      const now = new Date();
      const proposalValues = buildReconstructedProposalValues(latestVersion, {
        now,
        recoverySource: 'proposal_version',
      });

      if (!proposalValues.id || !proposalValues.userId) {
        throw new ApiError(422, 'invalid_recovery_snapshot', 'Latest proposal version is incomplete');
      }

      const [owner] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, proposalValues.userId))
        .limit(1);
      if (!owner) {
        throw new ApiError(409, 'recovery_owner_missing', 'Cannot reconstruct because the owning user is missing');
      }

      const comparisonValues = buildReconstructedDocumentComparisonValues(latestVersion, proposalValues.id, { now });
      if (comparisonValues?.userId) {
        const [comparisonOwner] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, comparisonValues.userId))
          .limit(1);
        if (!comparisonOwner) {
          throw new ApiError(
            409,
            'recovery_comparison_owner_missing',
            'Cannot reconstruct linked document comparison because its owner is missing',
          );
        }
      }

      const comparisonInsertQuery =
        comparisonValues
          ? db
              .insert(schema.documentComparisons)
              .values(comparisonValues)
              .onConflictDoNothing()
          : null;

      const { queries: historyQueries } = buildProposalHistoryQueries(db, {
        proposal: proposalValues,
        actorUserId: auth.user.id,
        actorRole: 'admin',
        milestone: 'reconstruct',
        eventType: 'proposal.reconstructed',
        eventData: {
          reconstructed_from_version_id: latestVersion.id,
        },
        documentComparison: comparisonValues,
        createdAt: now,
        requestId: context.requestId,
        snapshotMeta: {
          reconstructed: true,
          reconstructed_from_version_id: latestVersion.id,
        },
      });

      const queries = [
        db.insert(schema.proposals).values(proposalValues).returning(),
      ];
      if (comparisonInsertQuery) {
        queries.push(comparisonInsertQuery);
      }
      queries.push(...historyQueries);

      await db.batch(queries);

      const results = await lookupProposalRecoveryRecords(db, { proposalId });
      ok(res, 200, {
        restored: true,
        action: 'reconstruct_from_latest_version',
        reconstructed_from_version_id: latestVersion.id,
        results: results.map(mapRecoveryRecordForResponse),
      });
      return;
    }

    throw new ApiError(400, 'invalid_action', 'Unsupported recovery action');
  });
}
