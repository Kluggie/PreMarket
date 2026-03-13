import { newId } from './ids.js';
import { schema } from './db/client.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDateOrNull(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    return value
      .map((entry) => toJsonSafe(entry))
      .filter((entry) => entry !== undefined);
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

function cloneObject(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return toJsonSafe(value);
}

function normalizeProposalPayload(payload, recovery) {
  const basePayload = isPlainObject(payload) ? { ...payload } : {};
  return {
    ...basePayload,
    recovery: {
      ...(isPlainObject(basePayload.recovery) ? basePayload.recovery : {}),
      ...recovery,
    },
  };
}

export function buildProposalRecoverySnapshot(params = {}) {
  const extra = cloneObject(params.extra);
  const snapshot = {
    proposal: toJsonSafe(params.proposal || null),
    documentComparison: toJsonSafe(params.documentComparison || null),
    sharedLinks: toJsonSafe(Array.isArray(params.sharedLinks) ? params.sharedLinks : []),
    recipientRevisions: toJsonSafe(Array.isArray(params.recipientRevisions) ? params.recipientRevisions : []),
    evaluations: toJsonSafe(Array.isArray(params.evaluations) ? params.evaluations : []),
    extra,
  };
  return snapshot;
}

export function buildProposalHistoryQueries(db, params = {}) {
  const proposalId = String(params.proposal?.id || params.proposalId || '').trim();
  if (!proposalId) {
    throw new Error('proposal history requires a proposal id');
  }

  const createdAt = params.createdAt instanceof Date ? params.createdAt : new Date();
  const includeVersion = params.includeVersion !== false;
  const actorUserId = String(params.actorUserId || '').trim() || null;
  const actorRole = String(params.actorRole || '').trim() || null;
  const proposalUserId = String(
    params.proposal?.userId || params.proposal?.user_id || params.proposalUserId || '',
  ).trim() || null;
  const milestone = String(params.milestone || params.eventType || 'snapshot').trim() || 'snapshot';
  const eventType = String(params.eventType || milestone).trim() || 'proposal.updated';
  const proposalStatus = String(params.proposal?.status || params.status || 'active').trim() || 'active';
  const snapshot = buildProposalRecoverySnapshot({
    proposal: params.proposal || null,
    documentComparison: params.documentComparison || null,
    sharedLinks: params.sharedLinks || [],
    recipientRevisions: params.recipientRevisions || [],
    evaluations: params.evaluations || [],
    extra: params.extra || {},
  });
  const snapshotMeta = {
    milestone,
    request_id: params.requestId || null,
    source: params.source || 'proposal_lifecycle',
    event_type: eventType,
    ...(cloneObject(params.snapshotMeta || {})),
  };

  const versionId = includeVersion ? newId('proposal_ver') : null;
  const queries = [];

  if (includeVersion) {
    queries.push(
      db.insert(schema.proposalVersions).values({
        id: versionId,
        proposalId,
        proposalUserId,
        actorUserId,
        actorRole,
        milestone,
        status: proposalStatus,
        snapshotData: snapshot,
        snapshotMeta,
        createdAt,
      }),
    );
  }

  queries.push(
    db.insert(schema.proposalEvents).values({
      id: newId('proposal_evt'),
      proposalId,
      proposalUserId,
      actorUserId,
      actorRole,
      proposalVersionId: versionId,
      requestId: params.requestId || null,
      eventType,
      eventData: {
        ...(cloneObject(params.eventData || {})),
        milestone,
        proposal_status: proposalStatus,
      },
      createdAt,
    }),
  );

  return {
    versionId,
    snapshot,
    queries,
  };
}

export async function appendProposalHistory(db, params = {}) {
  const { versionId, snapshot, queries } = buildProposalHistoryQueries(db, params);
  if (queries.length > 0) {
    await db.batch(queries);
  }
  return { versionId, snapshot };
}

export function getProposalSnapshotFromVersion(versionRow) {
  if (!isPlainObject(versionRow?.snapshotData)) {
    return null;
  }
  return isPlainObject(versionRow.snapshotData.proposal) ? versionRow.snapshotData.proposal : null;
}

export function getDocumentComparisonSnapshotFromVersion(versionRow) {
  if (!isPlainObject(versionRow?.snapshotData)) {
    return null;
  }
  return isPlainObject(versionRow.snapshotData.documentComparison)
    ? versionRow.snapshotData.documentComparison
    : null;
}

export function buildReconstructedProposalValues(versionRow, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const recoverySource = String(options.recoverySource || 'proposal_version').trim() || 'proposal_version';
  const proposal = getProposalSnapshotFromVersion(versionRow);

  if (!proposal) {
    throw new Error('version snapshot does not contain proposal data');
  }

  const title = String(proposal.title || '').trim() || 'Recovered Proposal';
  const payload = normalizeProposalPayload(proposal.payload, {
    reconstructed: true,
    reconstructed_at: now.toISOString(),
    reconstructed_from_version_id: String(versionRow?.id || '').trim() || null,
    recovery_source: recoverySource,
  });

  return {
    id: String(proposal.id || '').trim(),
    userId: String(proposal.userId || proposal.user_id || '').trim(),
    title,
    status: String(proposal.status || 'draft').trim() || 'draft',
    statusReason: String(proposal.statusReason || proposal.status_reason || '').trim() || null,
    templateId: String(proposal.templateId || proposal.template_id || '').trim() || null,
    templateName: String(proposal.templateName || proposal.template_name || '').trim() || null,
    proposalType:
      String(proposal.proposalType || proposal.proposal_type || '').trim().toLowerCase() || 'standard',
    draftStep: Number.isFinite(Number(proposal.draftStep || proposal.draft_step))
      ? Math.max(1, Math.min(4, Math.floor(Number(proposal.draftStep || proposal.draft_step))))
      : 1,
    sourceProposalId: String(proposal.sourceProposalId || proposal.source_proposal_id || '').trim() || null,
    documentComparisonId:
      String(proposal.documentComparisonId || proposal.document_comparison_id || '').trim() || null,
    partyAEmail: String(proposal.partyAEmail || proposal.party_a_email || '').trim().toLowerCase() || null,
    partyBEmail: String(proposal.partyBEmail || proposal.party_b_email || '').trim().toLowerCase() || null,
    summary: String(proposal.summary || '').trim() || null,
    sentAt: parseDateOrNull(proposal.sentAt || proposal.sent_at),
    receivedAt: parseDateOrNull(proposal.receivedAt || proposal.received_at),
    lastThreadActivityAt: parseDateOrNull(
      proposal.lastThreadActivityAt || proposal.last_thread_activity_at,
    ),
    lastThreadActorRole:
      String(proposal.lastThreadActorRole || proposal.last_thread_actor_role || '').trim() || null,
    lastThreadActivityType:
      String(proposal.lastThreadActivityType || proposal.last_thread_activity_type || '').trim() ||
      null,
    evaluatedAt: parseDateOrNull(proposal.evaluatedAt || proposal.evaluated_at),
    lastSharedAt: parseDateOrNull(proposal.lastSharedAt || proposal.last_shared_at),
    archivedAt: parseDateOrNull(proposal.archivedAt || proposal.archived_at),
    archivedByPartyAAt: parseDateOrNull(proposal.archivedByPartyAAt || proposal.archived_by_party_a_at),
    archivedByPartyBAt: parseDateOrNull(proposal.archivedByPartyBAt || proposal.archived_by_party_b_at),
    closedAt: parseDateOrNull(proposal.closedAt || proposal.closed_at),
    partyAOutcome: String(proposal.partyAOutcome || proposal.party_a_outcome || '').trim() || null,
    partyAOutcomeAt: parseDateOrNull(proposal.partyAOutcomeAt || proposal.party_a_outcome_at),
    partyBOutcome: String(proposal.partyBOutcome || proposal.party_b_outcome || '').trim() || null,
    partyBOutcomeAt: parseDateOrNull(proposal.partyBOutcomeAt || proposal.party_b_outcome_at),
    deletedByPartyAAt: parseDateOrNull(proposal.deletedByPartyAAt || proposal.deleted_by_party_a_at),
    deletedByPartyBAt: parseDateOrNull(proposal.deletedByPartyBAt || proposal.deleted_by_party_b_at),
    reconstructedAt: now,
    reconstructedFromVersionId: String(versionRow?.id || '').trim() || null,
    recoverySource,
    payload,
    createdAt: parseDateOrNull(proposal.createdAt || proposal.created_at) || now,
    updatedAt: now,
  };
}

export function buildReconstructedDocumentComparisonValues(versionRow, proposalId, options = {}) {
  const snapshot = getDocumentComparisonSnapshotFromVersion(versionRow);
  if (!snapshot) {
    return null;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const comparisonId = String(snapshot.id || '').trim();
  const userId = String(snapshot.userId || snapshot.user_id || '').trim();
  if (!comparisonId || !userId) {
    return null;
  }

  return {
    id: comparisonId,
    userId,
    proposalId: String(proposalId || '').trim() || null,
    title: String(snapshot.title || '').trim() || 'Recovered Comparison',
    status: String(snapshot.status || 'draft').trim() || 'draft',
    draftStep: Number.isFinite(Number(snapshot.draftStep || snapshot.draft_step))
      ? Math.max(1, Math.min(4, Math.floor(Number(snapshot.draftStep || snapshot.draft_step))))
      : 1,
    partyALabel: String(snapshot.partyALabel || snapshot.party_a_label || '').trim() || 'Document A',
    partyBLabel: String(snapshot.partyBLabel || snapshot.party_b_label || '').trim() || 'Document B',
    companyName: String(snapshot.companyName || snapshot.company_name || '').trim() || null,
    companyWebsite: String(snapshot.companyWebsite || snapshot.company_website || '').trim() || null,
    docAText: String(snapshot.docAText || snapshot.doc_a_text || '').trim() || null,
    docBText: String(snapshot.docBText || snapshot.doc_b_text || '').trim() || null,
    docASpans: Array.isArray(snapshot.docASpans || snapshot.doc_a_spans)
      ? (snapshot.docASpans || snapshot.doc_a_spans)
      : [],
    docBSpans: Array.isArray(snapshot.docBSpans || snapshot.doc_b_spans)
      ? (snapshot.docBSpans || snapshot.doc_b_spans)
      : [],
    evaluationResult: cloneObject(snapshot.evaluationResult || snapshot.evaluation_result),
    publicReport: cloneObject(snapshot.publicReport || snapshot.public_report),
    inputs: cloneObject(snapshot.inputs),
    metadata: cloneObject(snapshot.metadata),
    createdAt: parseDateOrNull(snapshot.createdAt || snapshot.created_at) || now,
    updatedAt: now,
  };
}
