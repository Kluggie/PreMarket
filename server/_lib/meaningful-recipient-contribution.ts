import {
  HISTORY_AUTHOR_RECIPIENT,
  HISTORY_VISIBILITY_CONFIDENTIAL,
  HISTORY_VISIBILITY_SHARED,
  normalizeContributionPayload,
  normalizeHistoryAuthorRole,
} from './shared-report-history.js';
import { sanitizeEditorText } from './document-editor-sanitization.js';
import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
} from '../../src/lib/opportunityReviewStage.js';

type ContributionVisibility =
  | typeof HISTORY_VISIBILITY_SHARED
  | typeof HISTORY_VISIBILITY_CONFIDENTIAL;
type ReviewStage = typeof PRE_SEND_REVIEW_STAGE | typeof MEDIATION_REVIEW_STAGE;

const MIN_MEANINGFUL_TEXT_CHARS = 18;
const MIN_MEANINGFUL_TOKEN_COUNT = 4;
const MIN_MEANINGFUL_TOKEN_DELTA = 2;
const MIN_MEANINGFUL_CHAR_DELTA = 12;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSemanticText(value: string) {
  return sanitizeEditorText(String(value || ''))
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .trim()
    .toLowerCase();
}

function extractStructuredText(value: unknown): string {
  const parts: string[] = [];

  const visit = (node: unknown) => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === 'string') {
      const text = asText(node);
      if (text) {
        parts.push(text);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') {
      return;
    }

    const record = node as Record<string, unknown>;
    const text = asText(record.text);
    if (text) {
      parts.push(text);
    }
    if (Array.isArray(record.content)) {
      record.content.forEach(visit);
    }
  };

  visit(value);
  return normalizeSemanticText(parts.join(' '));
}

function tokenizeSemanticText(text: string) {
  return (text.match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || []).filter(
    (token) => token.length >= 2 || /\d/.test(token),
  );
}

function buildTokenCounts(tokens: string[]) {
  const counts = new Map<string, number>();
  tokens.forEach((token) => {
    counts.set(token, (counts.get(token) || 0) + 1);
  });
  return counts;
}

function countPositiveTokenDelta(left: string[], right: string[]) {
  const leftCounts = buildTokenCounts(left);
  const rightCounts = buildTokenCounts(right);
  let delta = 0;
  leftCounts.forEach((count, token) => {
    delta += Math.max(0, count - (rightCounts.get(token) || 0));
  });
  return delta;
}

function normalizeFileKeys(files: unknown) {
  if (!Array.isArray(files)) {
    return [] as string[];
  }

  const keys = new Set<string>();
  files.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return;
    }
    const file = entry as Record<string, unknown>;
    const documentId = asText(file.documentId || file.document_id).toLowerCase();
    const filename = asText(file.filename || file.name).toLowerCase();
    const mimeType = asText(file.mimeType || file.mime_type || file.type).toLowerCase();
    const sizeBytes = Number(file.sizeBytes || file.size_bytes || file.size || 0) || 0;
    if (!documentId && !filename && sizeBytes <= 0) {
      return;
    }
    keys.add([documentId, filename, mimeType, sizeBytes].join('|'));
  });
  return [...keys];
}

type PayloadEvidence = {
  semanticText: string;
  semanticTokens: string[];
  fileKeys: string[];
};

function buildPayloadEvidence(
  payload: unknown,
  options: {
    defaultLabel?: string;
    visibility?: ContributionVisibility;
  } = {},
): PayloadEvidence {
  const normalized = normalizeContributionPayload(payload, {
    defaultLabel: options.defaultLabel,
    visibility: options.visibility,
  });
  const textCandidates = new Set<string>();
  const visibleText = normalizeSemanticText(asText(normalized.text || normalized.notes));
  const structuredText = extractStructuredText(normalized.json);
  if (visibleText) {
    textCandidates.add(visibleText);
  }
  if (structuredText) {
    textCandidates.add(structuredText);
  }
  const semanticText = [...textCandidates].join(' ').trim();
  return {
    semanticText,
    semanticTokens: tokenizeSemanticText(semanticText),
    fileKeys: normalizeFileKeys(normalized.files),
  };
}

function isStandaloneMeaningfulText(evidence: PayloadEvidence) {
  return (
    evidence.semanticText.length >= MIN_MEANINGFUL_TEXT_CHARS ||
    evidence.semanticTokens.length >= MIN_MEANINGFUL_TOKEN_COUNT
  );
}

function hasMeaningfulTextDelta(candidate: PayloadEvidence, baseline: PayloadEvidence) {
  if (!candidate.semanticText) {
    return false;
  }
  if (!baseline.semanticText) {
    return isStandaloneMeaningfulText(candidate);
  }
  if (candidate.semanticText === baseline.semanticText) {
    return false;
  }

  const addedTokens = countPositiveTokenDelta(candidate.semanticTokens, baseline.semanticTokens);
  const removedTokens = countPositiveTokenDelta(baseline.semanticTokens, candidate.semanticTokens);
  const charDelta = Math.abs(candidate.semanticText.length - baseline.semanticText.length);

  return (
    addedTokens >= MIN_MEANINGFUL_TOKEN_DELTA ||
    removedTokens >= MIN_MEANINGFUL_TOKEN_DELTA ||
    (charDelta >= MIN_MEANINGFUL_CHAR_DELTA &&
      candidate.semanticTokens.length >= Math.min(MIN_MEANINGFUL_TOKEN_COUNT, baseline.semanticTokens.length + 1))
  );
}

export type MeaningfulPayloadContributionResult = {
  hasMeaningfulContribution: boolean;
  reasons: string[];
  semanticText: string;
  fileKeys: string[];
};

/**
 * Canonical bilateral-activation rule:
 * - Ignore whitespace-only, punctuation-only, and cosmetic HTML/markup-only edits.
 * - Treat text as meaningful only when the normalized semantic text is substantive
 *   (>= 18 chars or >= 4 tokens) and materially different (>= 2 token delta or
 *   >= 12 normalized chars changed).
 * - Treat structured editor JSON as text-bearing evidence, not raw markup.
 * - Treat files as meaningful only when they introduce materially new file identities.
 */
export function evaluateMeaningfulPayloadContribution(params: {
  payload: unknown;
  baselinePayload?: unknown;
  defaultLabel?: string;
  visibility?: ContributionVisibility;
}): MeaningfulPayloadContributionResult {
  const candidate = buildPayloadEvidence(params.payload, {
    defaultLabel: params.defaultLabel,
    visibility: params.visibility,
  });
  const reasons: string[] = [];

  if (params.baselinePayload !== undefined) {
    const baseline = buildPayloadEvidence(params.baselinePayload, {
      defaultLabel: params.defaultLabel,
      visibility: params.visibility,
    });
    const baselineFiles = new Set(baseline.fileKeys);
    if (candidate.fileKeys.some((key) => !baselineFiles.has(key))) {
      reasons.push('new_file_attachment');
    }
    if (hasMeaningfulTextDelta(candidate, baseline)) {
      reasons.push('semantic_text_delta');
    }
  } else {
    if (candidate.fileKeys.length > 0) {
      reasons.push('file_attachment_present');
    }
    if (isStandaloneMeaningfulText(candidate)) {
      reasons.push('substantive_text_present');
    }
  }

  return {
    hasMeaningfulContribution: reasons.length > 0,
    reasons,
    semanticText: candidate.semanticText,
    fileKeys: candidate.fileKeys,
  };
}

export function hasMeaningfulContributionEntry(entry: unknown) {
  const record =
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {};
  const visibility =
    asText(record.visibility).toLowerCase() === HISTORY_VISIBILITY_CONFIDENTIAL
      ? HISTORY_VISIBILITY_CONFIDENTIAL
      : HISTORY_VISIBILITY_SHARED;

  return evaluateMeaningfulPayloadContribution({
    payload: record.contentPayload,
    defaultLabel:
      visibility === HISTORY_VISIBILITY_CONFIDENTIAL
        ? 'Confidential to Recipient'
        : 'Shared by Recipient',
    visibility,
  }).hasMeaningfulContribution;
}

export type MeaningfulRecipientContributionResult = {
  hasMeaningfulContribution: boolean;
  historyContributionIds: string[];
  draftSignals: Array<{ key: string; reasons: string[] }>;
};

export function hasMeaningfulRecipientContribution(params: {
  recipientAuthorRole?: string;
  historyContributions?: unknown[];
  historyBaselinePayloads?: {
    shared?: unknown;
    confidential?: unknown;
  };
  draftPayloads?: Array<{
    key: string;
    payload: unknown;
    baselinePayload?: unknown;
    defaultLabel?: string;
    visibility?: ContributionVisibility;
  }>;
}): MeaningfulRecipientContributionResult {
  const recipientAuthorRole = normalizeHistoryAuthorRole(
    params.recipientAuthorRole || HISTORY_AUTHOR_RECIPIENT,
  );
  const historyContributionIds = (Array.isArray(params.historyContributions) ? params.historyContributions : [])
    .filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
      }
      const record = entry as Record<string, unknown>;
      return normalizeHistoryAuthorRole(record.authorRole) === recipientAuthorRole;
    })
    .filter((entry) => {
      const record = entry as Record<string, unknown>;
      const visibility =
        asText(record.visibility).toLowerCase() === HISTORY_VISIBILITY_CONFIDENTIAL
          ? HISTORY_VISIBILITY_CONFIDENTIAL
          : HISTORY_VISIBILITY_SHARED;
      const baselinePayload =
        visibility === HISTORY_VISIBILITY_CONFIDENTIAL
          ? params.historyBaselinePayloads?.confidential
          : params.historyBaselinePayloads?.shared;
      return evaluateMeaningfulPayloadContribution({
        payload: record.contentPayload,
        baselinePayload,
        defaultLabel:
          visibility === HISTORY_VISIBILITY_CONFIDENTIAL
            ? 'Confidential to Recipient'
            : 'Shared by Recipient',
        visibility,
      }).hasMeaningfulContribution;
    })
    .map((entry) => asText((entry as Record<string, unknown>).id))
    .filter(Boolean);

  const draftSignals = (Array.isArray(params.draftPayloads) ? params.draftPayloads : [])
    .map((payload) => ({
      key: asText(payload.key) || 'draft',
      result: evaluateMeaningfulPayloadContribution(payload),
    }))
    .filter((entry) => entry.result.hasMeaningfulContribution)
    .map((entry) => ({
      key: entry.key,
      reasons: entry.result.reasons,
    }));

  return {
    hasMeaningfulContribution:
      historyContributionIds.length > 0 || draftSignals.length > 0,
    historyContributionIds,
    draftSignals,
  };
}

export function resolveReviewStageFromRecipientContribution(params: {
  recipientAuthorRole?: string;
  historyContributions?: unknown[];
  historyBaselinePayloads?: {
    shared?: unknown;
    confidential?: unknown;
  };
  draftPayloads?: Array<{
    key: string;
    payload: unknown;
    baselinePayload?: unknown;
    defaultLabel?: string;
    visibility?: ContributionVisibility;
  }>;
}): ReviewStage {
  return hasMeaningfulRecipientContribution(params).hasMeaningfulContribution
    ? MEDIATION_REVIEW_STAGE
    : PRE_SEND_REVIEW_STAGE;
}
