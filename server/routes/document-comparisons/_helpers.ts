import { ApiError } from '../../_lib/errors.js';

export function mapComparisonRow(row: any) {
  const inputs =
    row?.inputs && typeof row.inputs === 'object' && !Array.isArray(row.inputs)
      ? row.inputs
      : {};
  const docASource =
    typeof inputs.doc_a_source === 'string' && inputs.doc_a_source.trim().length > 0
      ? inputs.doc_a_source.trim()
      : 'typed';
  const docBSource =
    typeof inputs.doc_b_source === 'string' && inputs.doc_b_source.trim().length > 0
      ? inputs.doc_b_source.trim()
      : 'typed';

  return {
    id: row.id,
    user_id: row.userId,
    proposal_id: row.proposalId || null,
    title: row.title,
    status: row.status,
    draft_step: Number(row.draftStep || 1),
    party_a_label: row.partyALabel || 'Document A',
    party_b_label: row.partyBLabel || 'Document B',
    doc_a_text: row.docAText || '',
    doc_b_text: row.docBText || '',
    doc_a_source: docASource,
    doc_b_source: docBSource,
    doc_a_files: Array.isArray(inputs.doc_a_files) ? inputs.doc_a_files : [],
    doc_b_files: Array.isArray(inputs.doc_b_files) ? inputs.doc_b_files : [],
    doc_a_url:
      typeof inputs.doc_a_url === 'string' && inputs.doc_a_url.trim().length > 0
        ? inputs.doc_a_url.trim()
        : null,
    doc_b_url:
      typeof inputs.doc_b_url === 'string' && inputs.doc_b_url.trim().length > 0
        ? inputs.doc_b_url.trim()
        : null,
    doc_a_spans: Array.isArray(row.docASpans) ? row.docASpans : [],
    doc_b_spans: Array.isArray(row.docBSpans) ? row.docBSpans : [],
    evaluation_result: row.evaluationResult || {},
    public_report: row.publicReport || {},
    inputs: row.inputs || {},
    metadata: row.metadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

function clampSpanBoundary(raw: unknown, textLength: number) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(Math.floor(numeric), textLength));
}

function normalizeSpanLevel(level: unknown) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

export function normalizeSpans(spans: unknown, text: string) {
  if (!Array.isArray(spans)) {
    return [];
  }

  const textLength = String(text || '').length;
  const normalized = spans
    .map((span) => {
      const start = clampSpanBoundary(span?.start, textLength);
      const end = clampSpanBoundary(span?.end, textLength);
      const level = normalizeSpanLevel(span?.level);

      if (start === null || end === null || end <= start || !level) {
        return null;
      }

      return { start, end, level };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  const merged = [];
  normalized.forEach((span) => {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      return;
    }

    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      return;
    }

    merged.push({ ...span });
  });

  return merged;
}

export function parseStep(value: unknown, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(numeric), 1), 4);
}

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

export function resolveEditableSide(params: { proposal?: any; user?: any; comparison?: any }) {
  const proposal = params?.proposal || null;
  const user = params?.user || null;
  const comparison = params?.comparison || null;
  const userId = String(user?.id || '').trim();
  const userEmail = normalizeEmail(user?.email);

  if (proposal) {
    const partyAUserId = String(proposal?.partyAUserId || proposal?.userId || '').trim();
    const partyAEmail = normalizeEmail(proposal?.partyAEmail);
    if ((userId && partyAUserId && userId === partyAUserId) || (userEmail && partyAEmail === userEmail)) {
      return 'a';
    }

    const partyBUserId = String(proposal?.partyBUserId || '').trim();
    const partyBEmail = normalizeEmail(proposal?.partyBEmail);
    if ((userId && partyBUserId && userId === partyBUserId) || (userEmail && partyBEmail === userEmail)) {
      return 'b';
    }
  }

  if (comparison && userId && String(comparison?.userId || '').trim() === userId) {
    return 'a';
  }

  return 'a';
}

export function isPastDate(dateValue: unknown) {
  if (!dateValue) {
    return false;
  }

  const timestamp = new Date(dateValue as any).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp < Date.now();
}

export function buildComparisonEvaluation(payload: {
  title: string;
  docAText: string;
  docBText: string;
  docASpans: Array<{ start: number; end: number; level: string }>;
  docBSpans: Array<{ start: number; end: number; level: string }>;
  partyALabel: string;
  partyBLabel: string;
}) {
  const docAText = String(payload.docAText || '');
  const docBText = String(payload.docBText || '');
  const tokenize = (input: string) =>
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((entry) => entry.length >= 3),
    );

  const tokensA = tokenize(docAText);
  const tokensB = tokenize(docBText);
  const intersection = new Set([...tokensA].filter((token) => tokensB.has(token)));
  const union = new Set([...tokensA, ...tokensB]);
  const similarity = union.size > 0 ? Math.round((intersection.size / union.size) * 100) : 0;
  const deltaChars = Math.abs(docAText.length - docBText.length);
  const confidentialityCount = payload.docASpans.length + payload.docBSpans.length;

  let fit = 'Low';
  if (similarity >= 80) fit = 'High';
  else if (similarity >= 55) fit = 'Medium';

  const nowIso = new Date().toISOString();
  const report = {
    generated_at: nowIso,
    title: payload.title,
    recommendation: fit,
    similarity_score: similarity,
    delta_characters: deltaChars,
    confidentiality_spans: confidentialityCount,
    sections: [
      {
        key: 'summary',
        heading: 'Comparison Summary',
        bullets: [
          `${payload.partyALabel} length: ${docAText.length} chars`,
          `${payload.partyBLabel} length: ${docBText.length} chars`,
          `Shared vocabulary: ${intersection.size} tokens`,
        ],
      },
      {
        key: 'confidentiality',
        heading: 'Confidentiality Highlights',
        bullets: [
          `Total marked spans: ${confidentialityCount}`,
          `Document A marked spans: ${payload.docASpans.length}`,
          `Document B marked spans: ${payload.docBSpans.length}`,
        ],
      },
    ],
  };

  return {
    score: similarity,
    recommendation: fit,
    report,
  };
}

export function ensureComparisonFound(row: any) {
  if (!row) {
    throw new ApiError(404, 'document_comparison_not_found', 'Document comparison not found');
  }
}
