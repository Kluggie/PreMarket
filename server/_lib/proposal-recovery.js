import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { schema } from './db/client.js';
import { normalizeProposalVisibilityEmail } from './proposal-visibility.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  return normalizeProposalVisibilityEmail(value);
}

function toJsonSafe(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafe(entry)).filter((entry) => entry !== undefined);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, toJsonSafe(entry)])
        .filter(([, entry]) => entry !== undefined),
    );
  }
  return value;
}

function hasRecoverySnapshot(versionRow) {
  return isPlainObject(versionRow?.snapshotData) && isPlainObject(versionRow.snapshotData.proposal);
}

function hasHistoricalArtifacts(record) {
  return Boolean(
    (record.documentComparisons || []).length ||
      (record.sharedLinks || []).length ||
      (record.recipientRevisions || []).length ||
      (record.evaluations || []).length ||
      (record.versions || []).length ||
      (record.events || []).length ||
      (record.auditRefs || []).length ||
      (record.notifications || []).length,
  );
}

function buildVisibilityState(proposal, sharedLinks) {
  const aliasAuthorizedSharedReport = (sharedLinks || []).some((link) => {
    const recipientEmail = normalizeEmail(link?.recipientEmail);
    const authorizedEmail = normalizeEmail(link?.authorizedEmail);
    return (
      trimText(link?.mode).toLowerCase() === 'shared_report' &&
      trimText(link?.authorizedUserId) &&
      recipientEmail &&
      authorizedEmail &&
      recipientEmail !== authorizedEmail
    );
  });

  return {
    owner: {
      archived: Boolean(proposal?.archivedByPartyAAt),
      softDeleted: Boolean(proposal?.deletedByPartyAAt),
      visible: Boolean(proposal && !proposal.archivedByPartyAAt && !proposal.deletedByPartyAAt),
    },
    recipient: {
      archived: Boolean(proposal?.archivedByPartyBAt),
      softDeleted: Boolean(proposal?.deletedByPartyBAt),
      visible: Boolean(proposal && !proposal.archivedByPartyBAt && !proposal.deletedByPartyBAt),
    },
    legacyFilterRisks: {
      aliasAuthorizedSharedReport,
    },
  };
}

function classifyRecord(record) {
  const evidence = [];
  const proposal = record.proposal || null;
  const visibility = buildVisibilityState(proposal, record.sharedLinks || []);

  if (proposal) {
    if (visibility.owner.softDeleted || visibility.recipient.softDeleted) {
      evidence.push('canonical proposal row exists');
      if (visibility.owner.softDeleted) {
        evidence.push('deleted_by_party_a_at is set');
      }
      if (visibility.recipient.softDeleted) {
        evidence.push('deleted_by_party_b_at is set');
      }
      return {
        classification: 'EXISTS_BUT_SOFT_DELETED',
        evidence,
        visibility,
      };
    }

    if (visibility.owner.archived || visibility.recipient.archived) {
      evidence.push('canonical proposal row exists');
      if (visibility.owner.archived) {
        evidence.push('archived_by_party_a_at is set');
      }
      if (visibility.recipient.archived) {
        evidence.push('archived_by_party_b_at is set');
      }
      return {
        classification: 'EXISTS_BUT_ARCHIVED',
        evidence,
        visibility,
      };
    }

    if (visibility.legacyFilterRisks.aliasAuthorizedSharedReport) {
      evidence.push('canonical proposal row exists');
      evidence.push('shared_report link is authorized to a user whose authorized_email differs from recipient_email');
      evidence.push('this row would have been hidden by the pre-fix email-only recipient visibility query');
      return {
        classification: 'EXISTS_BUT_HIDDEN_BY_FILTER',
        evidence,
        visibility,
      };
    }

    evidence.push('canonical proposal row exists');
    evidence.push('no archive or soft-delete flags are set');
    return {
      classification: 'EXISTS_AND_VISIBLE',
      evidence,
      visibility,
    };
  }

  if (hasHistoricalArtifacts(record)) {
    if ((record.versions || []).some(hasRecoverySnapshot)) {
      evidence.push('canonical proposal row is missing');
      evidence.push('proposal_versions still contain a recoverable proposal snapshot');
    } else {
      evidence.push('canonical proposal row is missing');
      evidence.push('linked historical artifacts still reference this proposal id');
    }
    return {
      classification: 'EXISTS_IN_LINKED_RECORDS_ONLY',
      evidence,
      visibility,
    };
  }

  evidence.push('no canonical proposal row found');
  evidence.push('no linked historical artifacts found');
  return {
    classification: 'HARD_DELETED_OR_MISSING',
    evidence,
    visibility,
  };
}

async function listCandidateProposalIds(db, filters = {}) {
  const proposalId = trimText(filters.proposalId);
  const userId = trimText(filters.userId);
  const email = normalizeEmail(filters.email);
  const ids = new Set();

  if (proposalId) {
    ids.add(proposalId);
  }

  const proposalClauses = [];
  if (proposalId) {
    proposalClauses.push(eq(schema.proposals.id, proposalId));
  }
  if (userId) {
    proposalClauses.push(eq(schema.proposals.userId, userId));
  }
  if (email) {
    proposalClauses.push(
      or(
        ilike(schema.proposals.partyAEmail, email),
        ilike(schema.proposals.partyBEmail, email),
      ),
    );
  }

  if (proposalClauses.length > 0) {
    const proposalRows = await db
      .select({ id: schema.proposals.id })
      .from(schema.proposals)
      .where(or(...proposalClauses));
    proposalRows.forEach((row) => {
      const id = trimText(row?.id);
      if (id) {
        ids.add(id);
      }
    });
  }

  const sharedLinkClauses = [];
  if (proposalId) {
    sharedLinkClauses.push(eq(schema.sharedLinks.proposalId, proposalId));
  }
  if (userId) {
    sharedLinkClauses.push(
      or(
        eq(schema.sharedLinks.userId, userId),
        eq(schema.sharedLinks.authorizedUserId, userId),
      ),
    );
  }
  if (email) {
    sharedLinkClauses.push(
      or(
        ilike(schema.sharedLinks.recipientEmail, email),
        ilike(schema.sharedLinks.authorizedEmail, email),
      ),
    );
  }

  if (sharedLinkClauses.length > 0) {
    const sharedLinkRows = await db
      .select({ proposalId: schema.sharedLinks.proposalId })
      .from(schema.sharedLinks)
      .where(or(...sharedLinkClauses));
    sharedLinkRows.forEach((row) => {
      const id = trimText(row?.proposalId);
      if (id) {
        ids.add(id);
      }
    });
  }

  const versionClauses = [];
  if (proposalId) {
    versionClauses.push(eq(schema.proposalVersions.proposalId, proposalId));
  }
  if (userId) {
    versionClauses.push(
      or(
        eq(schema.proposalVersions.proposalUserId, userId),
        eq(schema.proposalVersions.actorUserId, userId),
      ),
    );
  }
  if (versionClauses.length > 0) {
    const versionRows = await db
      .select({ proposalId: schema.proposalVersions.proposalId })
      .from(schema.proposalVersions)
      .where(or(...versionClauses));
    versionRows.forEach((row) => {
      const id = trimText(row?.proposalId);
      if (id) {
        ids.add(id);
      }
    });
  }

  if (email) {
    const emailVersionRows = await db.execute(sql`
      select distinct proposal_id
      from proposal_versions
      where lower(coalesce(snapshot_data->'proposal'->>'partyAEmail', snapshot_data->'proposal'->>'party_a_email', '')) = ${email}
         or lower(coalesce(snapshot_data->'proposal'->>'partyBEmail', snapshot_data->'proposal'->>'party_b_email', '')) = ${email}
    `);
    (emailVersionRows.rows || emailVersionRows || []).forEach((row) => {
      const id = trimText(row?.proposal_id);
      if (id) {
        ids.add(id);
      }
    });
  }

  if (proposalId) {
    const auditRows = await db.execute(sql`
      select distinct metadata->>'proposal_id' as proposal_id
      from audit_events
      where metadata->>'proposal_id' = ${proposalId}
      union
      select distinct metadata->>'proposal_id' as proposal_id
      from notifications
      where metadata->>'proposal_id' = ${proposalId}
    `);
    (auditRows.rows || auditRows || []).forEach((row) => {
      const id = trimText(row?.proposal_id);
      if (id) {
        ids.add(id);
      }
    });
  }

  return Array.from(ids);
}

async function loadProposalRecoveryRecord(db, proposalId) {
  const [proposal] = await db
    .select()
    .from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId))
    .limit(1);

  const documentComparisons = await db
    .select()
    .from(schema.documentComparisons)
    .where(eq(schema.documentComparisons.proposalId, proposalId))
    .orderBy(desc(schema.documentComparisons.updatedAt), desc(schema.documentComparisons.createdAt));

  const sharedLinks = await db
    .select()
    .from(schema.sharedLinks)
    .where(eq(schema.sharedLinks.proposalId, proposalId))
    .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt));

  const recipientRevisions = await db
    .select()
    .from(schema.sharedReportRecipientRevisions)
    .where(eq(schema.sharedReportRecipientRevisions.proposalId, proposalId))
    .orderBy(
      desc(schema.sharedReportRecipientRevisions.updatedAt),
      desc(schema.sharedReportRecipientRevisions.createdAt),
    );

  const evaluations = await db
    .select()
    .from(schema.proposalEvaluations)
    .where(eq(schema.proposalEvaluations.proposalId, proposalId))
    .orderBy(desc(schema.proposalEvaluations.createdAt));

  const versions = await db
    .select()
    .from(schema.proposalVersions)
    .where(eq(schema.proposalVersions.proposalId, proposalId))
    .orderBy(desc(schema.proposalVersions.createdAt));

  const events = await db
    .select()
    .from(schema.proposalEvents)
    .where(eq(schema.proposalEvents.proposalId, proposalId))
    .orderBy(desc(schema.proposalEvents.createdAt));

  const auditRefsRows = await db.execute(sql`
    select id, event_type, created_at, metadata
    from audit_events
    where metadata->>'proposal_id' = ${proposalId}
    order by created_at desc
  `);
  const notificationsRows = await db.execute(sql`
    select id, event_type, title, message, created_at, metadata
    from notifications
    where metadata->>'proposal_id' = ${proposalId}
    order by created_at desc
  `);

  const record = {
    proposalId,
    proposal: proposal || null,
    documentComparisons,
    sharedLinks,
    recipientRevisions,
    evaluations,
    versions,
    events,
    auditRefs: toJsonSafe(auditRefsRows.rows || auditRefsRows || []),
    notifications: toJsonSafe(notificationsRows.rows || notificationsRows || []),
  };

  const classification = classifyRecord(record);
  return {
    ...record,
    ...classification,
    reconstruction: {
      available: !proposal && versions.some(hasRecoverySnapshot),
      latestVersionId: trimText(versions[0]?.id) || null,
    },
  };
}

export async function lookupProposalRecoveryRecords(db, filters = {}) {
  const candidateIds = await listCandidateProposalIds(db, filters);
  const results = [];

  for (const proposalId of candidateIds) {
    results.push(await loadProposalRecoveryRecord(db, proposalId));
  }

  return results.sort((left, right) => {
    const leftUpdatedAt = trimText(left.proposal?.updatedAt || left.proposal?.updated_at || left.versions?.[0]?.createdAt);
    const rightUpdatedAt = trimText(right.proposal?.updatedAt || right.proposal?.updated_at || right.versions?.[0]?.createdAt);
    return rightUpdatedAt.localeCompare(leftUpdatedAt);
  });
}

export function mapRecoveryRecordForResponse(record) {
  return toJsonSafe({
    proposal_id: record.proposalId,
    classification: record.classification,
    classification_evidence: record.evidence,
    visibility: record.visibility,
    reconstruction: record.reconstruction,
    proposal: record.proposal,
    linked: {
      document_comparisons: record.documentComparisons,
      shared_links: record.sharedLinks,
      recipient_revisions: record.recipientRevisions,
      evaluations: record.evaluations,
    },
    history: {
      versions: record.versions,
      events: record.events,
      audit_refs: record.auditRefs,
      notifications: record.notifications,
    },
  });
}
