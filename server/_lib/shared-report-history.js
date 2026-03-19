import { createHash } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { schema } from './db/client.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from './document-editor-sanitization.js';

export const HISTORY_AUTHOR_PROPOSER = 'proposer';
export const HISTORY_AUTHOR_RECIPIENT = 'recipient';
export const HISTORY_VISIBILITY_SHARED = 'shared';
export const HISTORY_VISIBILITY_CONFIDENTIAL = 'confidential';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function parseDocJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (asText(value.type).toLowerCase() !== 'doc') {
    return null;
  }
  if (!Array.isArray(value.content)) {
    return null;
  }
  return value;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(value) {
  const normalized = String(value || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '<p></p>';
  }
  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }
  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function normalizePayloadFiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const file = toObject(entry);
      return {
        filename: asText(file.filename || file.name),
        mimeType: asText(file.mimeType || file.mime_type || file.type) || 'application/octet-stream',
        sizeBytes: Number(file.sizeBytes || file.size_bytes || file.size || 0) || 0,
        documentId: asText(file.documentId || file.document_id) || null,
      };
    });
}

function payloadHasVisibleContent(payload) {
  const safePayload = toObject(payload);
  const text = asText(safePayload.text || safePayload.notes);
  const html = asText(safePayload.html);
  const files = normalizePayloadFiles(safePayload.files);
  return Boolean(text || htmlToEditorText(html) || parseDocJson(safePayload.json) || files.length > 0);
}

export function normalizeHistoryAuthorRole(value) {
  const normalized = asText(value).toLowerCase();
  if (
    normalized === HISTORY_AUTHOR_PROPOSER ||
    normalized === 'party_a' ||
    normalized === 'partya' ||
    normalized === 'sender' ||
    normalized === 'owner'
  ) {
    return HISTORY_AUTHOR_PROPOSER;
  }
  if (
    normalized === HISTORY_AUTHOR_RECIPIENT ||
    normalized === 'party_b' ||
    normalized === 'partyb' ||
    normalized === 'counterparty'
  ) {
    return HISTORY_AUTHOR_RECIPIENT;
  }
  return HISTORY_AUTHOR_RECIPIENT;
}

export function getHistoryAuthorLabel(authorRole) {
  return normalizeHistoryAuthorRole(authorRole) === HISTORY_AUTHOR_PROPOSER
    ? 'Proposer'
    : 'Recipient';
}

export function getOppositeHistoryAuthorRole(authorRole) {
  return normalizeHistoryAuthorRole(authorRole) === HISTORY_AUTHOR_PROPOSER
    ? HISTORY_AUTHOR_RECIPIENT
    : HISTORY_AUTHOR_PROPOSER;
}

export function getProposalAuthorRole(proposal, userId) {
  const proposalUserId = asText(proposal?.userId);
  const normalizedUserId = asText(userId);
  if (!proposalUserId || !normalizedUserId) {
    return null;
  }
  return proposalUserId === normalizedUserId
    ? HISTORY_AUTHOR_PROPOSER
    : HISTORY_AUTHOR_RECIPIENT;
}

export function getLinkOwnerAuthorRole(params) {
  return getProposalAuthorRole(params?.proposal, params?.link?.userId) || HISTORY_AUTHOR_PROPOSER;
}

export function getLinkRecipientAuthorRole(params) {
  return getOppositeHistoryAuthorRole(getLinkOwnerAuthorRole(params));
}

export function resolveSharedReportLinkRound(reportMetadata) {
  const metadata = toObject(reportMetadata);
  const numeric = Number(metadata.exchange_round || metadata.round || 0);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }
  return Math.floor(numeric);
}

export function normalizeContributionPayload(payload, options = {}) {
  const safePayload = toObject(payload);
  const fallbackText = asText(options.fallbackText);
  const defaultLabel = asText(options.defaultLabel);
  const directText = asText(safePayload.text);
  const notesText = asText(safePayload.notes);
  const rawHtml = asText(safePayload.html);
  const sanitizedHtml = rawHtml ? sanitizeEditorHtml(rawHtml) : '';
  const normalizedText = sanitizeEditorText(
    directText || notesText || fallbackText || htmlToEditorText(sanitizedHtml),
  );
  const html =
    normalizedText || htmlToEditorText(sanitizedHtml)
      ? sanitizedHtml || sanitizeEditorHtml(textToHtml(normalizedText))
      : '';
  const files = normalizePayloadFiles(safePayload.files);
  const normalized = {
    label: asText(safePayload.label) || defaultLabel || null,
    text: normalizedText,
    html,
    json: parseDocJson(safePayload.json),
    source: asText(safePayload.source) || 'typed',
    files,
  };
  if (notesText || options.visibility === HISTORY_VISIBILITY_CONFIDENTIAL) {
    normalized.notes = normalizedText;
  }
  return normalized;
}

function buildPayloadFingerprint(payload) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        label: asText(payload?.label),
        text: asText(payload?.text),
        html: asText(payload?.html),
        source: asText(payload?.source),
        json: payload?.json || null,
        files: normalizePayloadFiles(payload?.files),
      }),
    )
    .digest('hex');
}

function coerceContributionNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function buildSharedPayloadFromComparison(params) {
  const proposal = params?.proposal || null;
  const comparison = params?.comparison || null;
  const comparisonInputs = toObject(comparison?.inputs);
  const text =
    asText(comparison?.docBText) ||
    asText(comparisonInputs.shared_doc_content) ||
    asText(comparisonInputs.doc_b_text) ||
    asText(comparisonInputs.docBText);
  return normalizeContributionPayload(
    {
      label: 'Shared Information',
      title: asText(comparison?.title) || asText(proposal?.title) || 'Shared Report',
      text,
      html: asText(comparisonInputs.doc_b_html),
      json: comparisonInputs.doc_b_json,
      source: asText(comparisonInputs.doc_b_source) || 'typed',
      files: comparisonInputs.doc_b_files,
    },
    {
      defaultLabel: 'Shared Information',
      visibility: HISTORY_VISIBILITY_SHARED,
    },
  );
}

function buildProposerConfidentialPayloadFromComparison(params) {
  const comparison = params?.comparison || null;
  const comparisonInputs = toObject(comparison?.inputs);
  return normalizeContributionPayload(
    {
      label: 'Confidential to Proposer',
      text:
        asText(comparison?.docAText) ||
        asText(comparisonInputs.confidential_doc_content) ||
        asText(comparisonInputs.doc_a_text) ||
        asText(comparisonInputs.docAText),
      html: asText(comparisonInputs.doc_a_html),
      json: comparisonInputs.doc_a_json,
      source: asText(comparisonInputs.doc_a_source) || 'typed',
      files: comparisonInputs.doc_a_files,
      notes:
        asText(comparison?.docAText) ||
        asText(comparisonInputs.confidential_doc_content) ||
        asText(comparisonInputs.doc_a_text) ||
        asText(comparisonInputs.docAText),
    },
    {
      defaultLabel: 'Confidential to Proposer',
      visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
    },
  );
}

function mapContributionRow(row) {
  const authorRole = normalizeHistoryAuthorRole(row?.authorRole);
  const visibility = asText(row?.visibility).toLowerCase() === HISTORY_VISIBILITY_CONFIDENTIAL
    ? HISTORY_VISIBILITY_CONFIDENTIAL
    : HISTORY_VISIBILITY_SHARED;
  return {
    id: row.id,
    proposalId: row.proposalId,
    comparisonId: row.comparisonId || null,
    sharedLinkId: row.sharedLinkId || null,
    authorRole,
    authorLabel: getHistoryAuthorLabel(authorRole),
    authorUserId: row.authorUserId || null,
    visibility,
    roundNumber: coerceContributionNumber(row.roundNumber),
    sequenceIndex: coerceContributionNumber(row.sequenceIndex),
    sourceKind: asText(row.sourceKind) || 'manual',
    contentPayload: normalizeContributionPayload(row.contentPayload, {
      defaultLabel:
        visibility === HISTORY_VISIBILITY_SHARED
          ? `Shared by ${getHistoryAuthorLabel(authorRole)}`
          : `Confidential to ${getHistoryAuthorLabel(authorRole)}`,
      visibility,
    }),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || row.createdAt || null,
    synthetic: false,
  };
}

function buildSyntheticContribution(params) {
  const authorRole = normalizeHistoryAuthorRole(params.authorRole);
  const visibility =
    asText(params.visibility).toLowerCase() === HISTORY_VISIBILITY_CONFIDENTIAL
      ? HISTORY_VISIBILITY_CONFIDENTIAL
      : HISTORY_VISIBILITY_SHARED;
  return {
    id: params.id,
    proposalId: params.proposalId || null,
    comparisonId: params.comparisonId || null,
    sharedLinkId: params.sharedLinkId || null,
    authorRole,
    authorLabel: getHistoryAuthorLabel(authorRole),
    authorUserId: params.authorUserId || null,
    visibility,
    roundNumber: coerceContributionNumber(params.roundNumber),
    sequenceIndex: coerceContributionNumber(params.sequenceIndex),
    sourceKind: asText(params.sourceKind) || 'legacy_snapshot',
    contentPayload: normalizeContributionPayload(params.contentPayload, {
      defaultLabel:
        visibility === HISTORY_VISIBILITY_SHARED
          ? `Shared by ${getHistoryAuthorLabel(authorRole)}`
          : `Confidential to ${getHistoryAuthorLabel(authorRole)}`,
      visibility,
    }),
    createdAt: params.createdAt || null,
    updatedAt: params.updatedAt || params.createdAt || null,
    synthetic: true,
  };
}

function compareContributionEntries(left, right) {
  const leftRound = coerceContributionNumber(left?.roundNumber) || Number.MAX_SAFE_INTEGER;
  const rightRound = coerceContributionNumber(right?.roundNumber) || Number.MAX_SAFE_INTEGER;
  if (leftRound !== rightRound) {
    return leftRound - rightRound;
  }

  const leftSeq = coerceContributionNumber(left?.sequenceIndex);
  const rightSeq = coerceContributionNumber(right?.sequenceIndex);
  if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  if (leftSeq !== null && rightSeq === null) {
    return -1;
  }
  if (leftSeq === null && rightSeq !== null) {
    return 1;
  }

  const leftTime = new Date(left?.createdAt || 0).getTime();
  const rightTime = new Date(right?.createdAt || 0).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function buildContributionMergeKey(entry) {
  return [
    normalizeHistoryAuthorRole(entry?.authorRole),
    asText(entry?.visibility).toLowerCase(),
    coerceContributionNumber(entry?.roundNumber) || 0,
    buildPayloadFingerprint(entry?.contentPayload || {}),
  ].join('|');
}

function buildLegacyBaselineEntries(params) {
  const proposal = params?.proposal || null;
  const comparison = params?.comparison || null;
  const includeShared = params?.includeShared !== false;
  const includeConfidential = params?.includeConfidential !== false;
  const entries = [];
  const sharedPayload = buildSharedPayloadFromComparison({ proposal, comparison });
  if (includeShared && payloadHasVisibleContent(sharedPayload)) {
    entries.push(
      buildSyntheticContribution({
        id: `legacy-shared:${comparison?.id || proposal?.id || 'proposal'}:proposer`,
        proposalId: proposal?.id || null,
        comparisonId: comparison?.id || null,
        authorRole: HISTORY_AUTHOR_PROPOSER,
        visibility: HISTORY_VISIBILITY_SHARED,
        roundNumber: 1,
        sequenceIndex: 1,
        sourceKind: 'legacy_snapshot',
        contentPayload: sharedPayload,
        createdAt: comparison?.createdAt || proposal?.createdAt || null,
        updatedAt: comparison?.updatedAt || proposal?.updatedAt || null,
      }),
    );
  }

  const confidentialPayload = buildProposerConfidentialPayloadFromComparison({ comparison });
  if (includeConfidential && payloadHasVisibleContent(confidentialPayload)) {
    entries.push(
      buildSyntheticContribution({
        id: `legacy-confidential:${comparison?.id || proposal?.id || 'proposal'}:proposer`,
        proposalId: proposal?.id || null,
        comparisonId: comparison?.id || null,
        authorRole: HISTORY_AUTHOR_PROPOSER,
        visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
        roundNumber: 1,
        sequenceIndex: 2,
        sourceKind: 'legacy_snapshot',
        contentPayload: confidentialPayload,
        createdAt: comparison?.createdAt || proposal?.createdAt || null,
        updatedAt: comparison?.updatedAt || proposal?.updatedAt || null,
      }),
    );
  }

  return entries;
}

async function loadLegacyRevisionEntries(params) {
  const db = params?.db;
  const proposal = params?.proposal || null;
  if (!db || !proposal?.id) {
    return [];
  }

  const rows = await db
    .select({
      revision: schema.sharedReportRecipientRevisions,
      link: schema.sharedLinks,
    })
    .from(schema.sharedReportRecipientRevisions)
    .leftJoin(
      schema.sharedLinks,
      eq(schema.sharedLinks.id, schema.sharedReportRecipientRevisions.sharedLinkId),
    )
    .where(eq(schema.sharedReportRecipientRevisions.proposalId, proposal.id))
    .orderBy(asc(schema.sharedReportRecipientRevisions.createdAt));

  const entries = [];
  rows.forEach(({ revision, link }) => {
    const status = asText(revision?.status).toLowerCase();
    if (status !== 'sent' && status !== 'superseded') {
      return;
    }

    const authorRole = getLinkRecipientAuthorRole({ proposal, link });
    const roundNumber = resolveSharedReportLinkRound(link?.reportMetadata) + 1;
    const createdAt = revision?.updatedAt || revision?.createdAt || null;
    const updatedAt = revision?.updatedAt || createdAt;

    const sharedPayload = normalizeContributionPayload(revision?.sharedPayload, {
      defaultLabel: `Shared by ${getHistoryAuthorLabel(authorRole)}`,
      visibility: HISTORY_VISIBILITY_SHARED,
    });
    if (payloadHasVisibleContent(sharedPayload)) {
      entries.push(
        buildSyntheticContribution({
          id: `legacy-revision:${revision.id}:shared`,
          proposalId: proposal.id,
          comparisonId: revision?.comparisonId || null,
          sharedLinkId: revision?.sharedLinkId || null,
          authorRole,
          visibility: HISTORY_VISIBILITY_SHARED,
          roundNumber,
          sourceKind: 'legacy_sent_revision',
          contentPayload: sharedPayload,
          createdAt,
          updatedAt,
        }),
      );
    }

    const confidentialPayload = normalizeContributionPayload(revision?.recipientConfidentialPayload, {
      defaultLabel: `Confidential to ${getHistoryAuthorLabel(authorRole)}`,
      visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
    });
    if (payloadHasVisibleContent(confidentialPayload)) {
      entries.push(
        buildSyntheticContribution({
          id: `legacy-revision:${revision.id}:confidential`,
          proposalId: proposal.id,
          comparisonId: revision?.comparisonId || null,
          sharedLinkId: revision?.sharedLinkId || null,
          authorRole,
          visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
          roundNumber,
          sourceKind: 'legacy_sent_revision',
          contentPayload: confidentialPayload,
          createdAt,
          updatedAt,
        }),
      );
    }
  });

  return entries;
}

function formatContributionFiles(entry) {
  const files = Array.isArray(entry?.contentPayload?.files) ? entry.contentPayload.files : [];
  const labels = files
    .map((file) => asText(file?.filename || file?.name))
    .filter(Boolean);
  if (!labels.length) {
    return '';
  }
  return `Files: ${labels.join(', ')}`;
}

export function formatContributionsForAi(entries, options = {}) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const includeFiles = options.includeFiles !== false;
  return normalizedEntries
    .map((entry) => {
      const authorLabel = getHistoryAuthorLabel(entry?.authorRole);
      const visibilityLabel =
        asText(entry?.visibility).toLowerCase() === HISTORY_VISIBILITY_CONFIDENTIAL
          ? 'Confidential Information'
          : 'Shared Information';
      const roundLabel = coerceContributionNumber(entry?.roundNumber);
      const header = `[Round ${roundLabel || '?'} | ${visibilityLabel} | Authored by ${authorLabel} | Contribution ${entry?.id || 'unknown'}]`;
      const parts = [header];
      const filesLine = includeFiles ? formatContributionFiles(entry) : '';
      if (filesLine) {
        parts.push(filesLine);
      }
      const text = asText(entry?.contentPayload?.text || entry?.contentPayload?.notes);
      const htmlText = htmlToEditorText(asText(entry?.contentPayload?.html));
      parts.push(text || htmlText || '(no text provided)');
      return parts.join('\n');
    })
    .join('\n\n---\n\n')
    .trim();
}

export function buildSharedHistoryComposite(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (!normalizedEntries.length) {
    return {
      text: '',
      html: '<p></p>',
    };
  }

  const text = normalizedEntries
    .map((entry) => {
      const label = asText(entry?.visibility_label || entry?.label) || 'Shared Information';
      const body = asText(entry?.text) || htmlToEditorText(asText(entry?.html)) || '(no text provided)';
      return `${label}\n\n${body}`;
    })
    .join('\n\n---\n\n')
    .trim();

  const html = normalizedEntries
    .map((entry) => {
      const label = asText(entry?.visibility_label || entry?.label) || 'Shared Information';
      const bodyHtml = asText(entry?.html) || textToHtml(asText(entry?.text));
      return `<section><p><strong>${escapeHtml(label)}</strong></p>${bodyHtml || '<p></p>'}</section>`;
    })
    .join('<hr/><p></p>');

  return {
    text,
    html: html || '<p></p>',
  };
}

function buildRoundSnapshots(sharedEntries) {
  const cumulative = [];
  const snapshots = [];
  let currentRound = null;
  for (const entry of sharedEntries) {
    cumulative.push(entry);
    const roundNumber = coerceContributionNumber(entry.roundNumber) || null;
    if (roundNumber === null || roundNumber === currentRound) {
      continue;
    }
    currentRound = roundNumber;
    snapshots.push({
      round: roundNumber,
      sharedTextSnapshot: formatContributionsForAi(cumulative),
      entries: [...cumulative],
    });
  }
  return snapshots;
}

function toSharedViewEntry(entry) {
  const authorLabel = getHistoryAuthorLabel(entry.authorRole);
  return {
    id: entry.id,
    author_role: entry.authorRole,
    author_label: authorLabel,
    visibility: entry.visibility,
    visibility_label: `Shared by ${authorLabel}`,
    round_number: entry.roundNumber,
    sequence_index: entry.sequenceIndex,
    source_kind: entry.sourceKind,
    label: entry.contentPayload?.label || `Shared by ${authorLabel}`,
    text: entry.contentPayload?.text || '',
    html: entry.contentPayload?.html || '',
    json: entry.contentPayload?.json || null,
    source: entry.contentPayload?.source || 'typed',
    files: entry.contentPayload?.files || [],
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    synthetic: Boolean(entry.synthetic),
  };
}

export async function loadSharedReportHistory(params) {
  const db = params?.db;
  const proposal = params?.proposal || null;
  const comparison = params?.comparison || null;
  if (!db || !proposal?.id) {
    return {
      contributions: [],
      sharedEntries: [],
      confidentialEntries: [],
      aiSharedHistoryText: '',
      aiConfidentialHistoryText: '',
      sharedRoundSnapshots: [],
      maxRoundNumber: 0,
    };
  }

  const persistedRows = await db
    .select()
    .from(schema.sharedReportContributions)
    .where(eq(schema.sharedReportContributions.proposalId, proposal.id))
    .orderBy(asc(schema.sharedReportContributions.sequenceIndex));

  const persistedEntries = persistedRows.map(mapContributionRow);
  const hasPersistedSharedBaseline = persistedEntries.some(
    (entry) =>
      entry.authorRole === HISTORY_AUTHOR_PROPOSER &&
      entry.visibility === HISTORY_VISIBILITY_SHARED,
  );
  const hasPersistedConfidentialBaseline = persistedEntries.some(
    (entry) =>
      entry.authorRole === HISTORY_AUTHOR_PROPOSER &&
      entry.visibility === HISTORY_VISIBILITY_CONFIDENTIAL,
  );
  const legacyEntries = [
    ...buildLegacyBaselineEntries({
      proposal,
      comparison,
      includeShared: !hasPersistedSharedBaseline,
      includeConfidential: !hasPersistedConfidentialBaseline,
    }),
    ...(await loadLegacyRevisionEntries({ db, proposal })),
  ];

  const merged = [];
  const seenKeys = new Set();

  persistedEntries.forEach((entry) => {
    const key = buildContributionMergeKey(entry);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(entry);
    }
  });

  legacyEntries.forEach((entry) => {
    const key = buildContributionMergeKey(entry);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(entry);
    }
  });

  merged.sort(compareContributionEntries);

  const sharedEntries = merged.filter(
    (entry) => entry.visibility === HISTORY_VISIBILITY_SHARED,
  );
  const confidentialEntries = merged.filter(
    (entry) => entry.visibility === HISTORY_VISIBILITY_CONFIDENTIAL,
  );
  const sharedRoundSnapshots = buildRoundSnapshots(sharedEntries);
  const maxRoundNumber = sharedRoundSnapshots.length
    ? Math.max(...sharedRoundSnapshots.map((entry) => Number(entry.round || 0) || 0))
    : 0;

  return {
    contributions: merged,
    sharedEntries: sharedEntries.map(toSharedViewEntry),
    confidentialEntries,
    aiSharedHistoryText: formatContributionsForAi(sharedEntries),
    aiConfidentialHistoryText: formatContributionsForAi(confidentialEntries),
    sharedRoundSnapshots,
    maxRoundNumber,
  };
}

function buildLatestContributionLookup(entries) {
  const latestByKey = new Map();
  let maxSequenceIndex = 0;
  entries.forEach((entry) => {
    const sequenceIndex = coerceContributionNumber(entry.sequenceIndex) || 0;
    maxSequenceIndex = Math.max(maxSequenceIndex, sequenceIndex);
    const key = `${normalizeHistoryAuthorRole(entry.authorRole)}:${asText(entry.visibility).toLowerCase()}`;
    if (!latestByKey.has(key)) {
      latestByKey.set(key, entry);
    }
  });
  return {
    latestByKey,
    maxSequenceIndex,
  };
}

export async function recordSharedReportContributionGroup(params) {
  const db = params?.db;
  const proposalId = asText(params?.proposalId);
  if (!db || !proposalId) {
    return [];
  }

  const authorRole = normalizeHistoryAuthorRole(params.authorRole);
  const now = params?.now instanceof Date ? params.now : new Date();
  const roundNumber = coerceContributionNumber(params?.roundNumber);

  const latestRows = await db
    .select()
    .from(schema.sharedReportContributions)
    .where(eq(schema.sharedReportContributions.proposalId, proposalId))
    .orderBy(desc(schema.sharedReportContributions.sequenceIndex))
    .limit(20);
  const latestEntries = latestRows.map(mapContributionRow);
  const { latestByKey, maxSequenceIndex } = buildLatestContributionLookup(latestEntries);

  let nextSequenceIndex = maxSequenceIndex;
  const values = [];

  const candidates = [
    {
      visibility: HISTORY_VISIBILITY_SHARED,
      payload: normalizeContributionPayload(params.sharedPayload, {
        defaultLabel: `Shared by ${getHistoryAuthorLabel(authorRole)}`,
        visibility: HISTORY_VISIBILITY_SHARED,
      }),
    },
    {
      visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
      payload: normalizeContributionPayload(params.confidentialPayload, {
        defaultLabel: `Confidential to ${getHistoryAuthorLabel(authorRole)}`,
        visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
      }),
    },
  ];

  candidates.forEach(({ visibility, payload }) => {
    if (!payloadHasVisibleContent(payload)) {
      return;
    }
    const latestEntry = latestByKey.get(`${authorRole}:${visibility}`) || null;
    if (
      latestEntry &&
      buildPayloadFingerprint(latestEntry.contentPayload) === buildPayloadFingerprint(payload)
    ) {
      return;
    }

    nextSequenceIndex += 1;
    values.push({
      id: params.newId ? params.newId('share_contrib') : null,
      proposalId,
      comparisonId: asText(params.comparisonId) || null,
      sharedLinkId: asText(params.sharedLinkId) || null,
      authorRole,
      authorUserId: asText(params.authorUserId) || null,
      visibility,
      roundNumber,
      sequenceIndex: nextSequenceIndex,
      sourceKind: asText(params.sourceKind) || 'manual',
      contentPayload: payload,
      previousContributionId: latestEntry?.id || null,
      createdAt: now,
      updatedAt: now,
    });
  });

  if (!values.length) {
    return [];
  }

  return db.insert(schema.sharedReportContributions).values(values).returning();
}

export async function recordInitialSharedReportBaseline(params) {
  return recordSharedReportContributionGroup({
    db: params?.db,
    proposalId: params?.proposal?.id,
    comparisonId: params?.comparison?.id || params?.proposal?.documentComparisonId || null,
    sharedLinkId: params?.sharedLinkId || null,
    authorRole: HISTORY_AUTHOR_PROPOSER,
    authorUserId: params?.authorUserId || params?.proposal?.userId || null,
    roundNumber: 1,
    sourceKind: 'shared_report_link_created',
    sharedPayload: buildSharedPayloadFromComparison({
      proposal: params?.proposal,
      comparison: params?.comparison,
    }),
    confidentialPayload: buildProposerConfidentialPayloadFromComparison({
      comparison: params?.comparison,
    }),
    newId: params?.newId,
    now: params?.now,
  });
}

export function buildDraftContributionEntries(params) {
  const authorRole = normalizeHistoryAuthorRole(params?.authorRole);
  const roundNumber = coerceContributionNumber(params?.roundNumber);
  const entries = [];

  const sharedPayload = normalizeContributionPayload(params?.sharedPayload, {
    defaultLabel: `Shared by ${getHistoryAuthorLabel(authorRole)}`,
    visibility: HISTORY_VISIBILITY_SHARED,
  });
  if (payloadHasVisibleContent(sharedPayload)) {
    entries.push(
      buildSyntheticContribution({
        id: params?.sharedId || `draft-shared:${authorRole}`,
        authorRole,
        visibility: HISTORY_VISIBILITY_SHARED,
        roundNumber,
        sourceKind: asText(params?.sourceKind) || 'draft',
        contentPayload: sharedPayload,
        createdAt: params?.createdAt || null,
        updatedAt: params?.updatedAt || null,
      }),
    );
  }

  const confidentialPayload = normalizeContributionPayload(params?.confidentialPayload, {
    defaultLabel: `Confidential to ${getHistoryAuthorLabel(authorRole)}`,
    visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
  });
  if (payloadHasVisibleContent(confidentialPayload)) {
    entries.push(
      buildSyntheticContribution({
        id: params?.confidentialId || `draft-confidential:${authorRole}`,
        authorRole,
        visibility: HISTORY_VISIBILITY_CONFIDENTIAL,
        roundNumber,
        sourceKind: asText(params?.sourceKind) || 'draft',
        contentPayload: confidentialPayload,
        createdAt: params?.createdAt || null,
        updatedAt: params?.updatedAt || null,
      }),
    );
  }

  return entries;
}
