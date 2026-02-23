import { ApiError } from '../../_lib/errors.js';

export const CONFIDENTIAL_LABEL = 'Confidential Information';
export const SHARED_LABEL = 'Shared Information';

function normalizeComparisonLabel(side: 'a' | 'b') {
  return side === 'a' ? CONFIDENTIAL_LABEL : SHARED_LABEL;
}

function asHtml(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text: string) {
  const normalized = String(text || '').replace(/\r/g, '').trim();
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
  const docAText = row.docAText || '';
  const docBText = row.docBText || '';
  const docAHtml = asHtml(inputs.doc_a_html) || textToHtml(docAText);
  const docBHtml = asHtml(inputs.doc_b_html) || textToHtml(docBText);
  const docAJson = asJsonObject(inputs.doc_a_json);
  const docBJson = asJsonObject(inputs.doc_b_json);

  return {
    id: row.id,
    user_id: row.userId,
    proposal_id: row.proposalId || null,
    title: row.title,
    status: row.status,
    draft_step: Number(row.draftStep || 1),
    party_a_label: normalizeComparisonLabel('a'),
    party_b_label: normalizeComparisonLabel('b'),
    doc_a_text: docAText,
    doc_b_text: docBText,
    doc_a_html: docAHtml,
    doc_b_html: docBHtml,
    doc_a_json: docAJson,
    doc_b_json: docBJson,
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
    doc_a_spans: [],
    doc_b_spans: [],
    evaluation_result: row.evaluationResult || {},
    public_report: row.publicReport || {},
    inputs: row.inputs || {},
    metadata: row.metadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

function toSafeObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, any>;
  }
  return value as Record<string, any>;
}

function toSafeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function clampScore(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, fallback))));
}

function clampConfidence(value: unknown, fallback = 0.35) {
  return Math.max(0, Math.min(1, toNumber(value, fallback)));
}

function clampRatio(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(1, toNumber(value, fallback)));
}

function normalizeLeakText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectConfidentialMarkers(confidentialText: string) {
  const normalized = normalizeLeakText(confidentialText);
  if (!normalized) {
    return [] as string[];
  }

  const markers = new Set<string>();
  const words = normalized.split(' ').filter((word) => word.length >= 3);
  for (let index = 0; index < words.length - 2 && markers.size < 120; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]} ${words[index + 2]}`.trim();
    if (phrase.length >= 14) {
      markers.add(phrase);
    }
  }

  const sentenceLike = normalized
    .split(/\s{2,}/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 18)
    .slice(0, 40);
  sentenceLike.forEach((entry) => {
    markers.add(entry.slice(0, 64));
  });

  return [...markers];
}

function containsConfidentialMarker(value: unknown, markers: string[]) {
  if (!markers.length) {
    return false;
  }

  const normalized = normalizeLeakText(value);
  if (!normalized) {
    return false;
  }

  return markers.some((marker) => marker.length >= 8 && normalized.includes(marker));
}

function scrubString(value: unknown, markers: string[], fallback = '') {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }
  if (containsConfidentialMarker(text, markers)) {
    return fallback;
  }
  return text;
}

function scrubStringArray(value: unknown, markers: string[]) {
  return toSafeArray(value)
    .map((entry) => scrubString(entry, markers, ''))
    .filter(Boolean);
}

function hasDocAIdentifier(value: unknown) {
  const normalized = normalizeLeakText(value);
  if (!normalized) {
    return false;
  }
  if (normalized === 'a' || normalized === 'party a' || normalized === 'party_a') {
    return true;
  }
  if (normalized.includes('doc a') || normalized.includes('doc_a')) {
    return true;
  }
  return normalized.includes('doc a visible') || normalized.includes('doc_a_visible');
}

function sanitizeEvidenceQuestionIds(value: unknown) {
  const unique = new Set<string>();
  toSafeArray(value).forEach((entry) => {
    const id = String(entry || '').trim();
    if (!id || hasDocAIdentifier(id)) {
      return;
    }
    unique.add(id);
  });
  return [...unique];
}

function sanitizeEvidenceAnchors(value: unknown) {
  return toSafeArray(value)
    .map((anchor) => {
      const doc = String(anchor?.doc || '').trim().toUpperCase();
      const start = Math.max(0, Math.floor(toNumber(anchor?.start, -1)));
      const end = Math.max(0, Math.floor(toNumber(anchor?.end, -1)));
      if (doc !== 'B' || end <= start) {
        return null;
      }
      return {
        doc: 'B',
        start,
        end,
      };
    })
    .filter(Boolean);
}

function entryMentionsDocA(entry: Record<string, any>) {
  if (hasDocAIdentifier(entry?.party) || hasDocAIdentifier(entry?.to_party)) {
    return true;
  }

  const idFields = ['evidence_question_ids', 'related_question_ids', 'question_ids'];
  if (
    idFields.some((field) =>
      toSafeArray(entry?.[field]).some((id) => hasDocAIdentifier(id)),
    )
  ) {
    return true;
  }

  const anchors = toSafeArray(entry?.evidence_anchors);
  if (anchors.some((anchor) => String(anchor?.doc || '').trim().toUpperCase() === 'A')) {
    return true;
  }

  const targets = toSafeObject(entry?.targets);
  if (
    toSafeArray(targets.question_ids).some((id) => hasDocAIdentifier(id)) ||
    toSafeArray(targets.evidence_anchors).some((anchor) => String(anchor?.doc || '').trim().toUpperCase() === 'A')
  ) {
    return true;
  }

  return false;
}

function sanitizeEvidenceEntry(entry: unknown, markers: string[]) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const source = { ...(entry as Record<string, any>) };
  if (entryMentionsDocA(source)) {
    return null;
  }

  const next: Record<string, any> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'evidence_question_ids' || key === 'related_question_ids' || key === 'question_ids') {
      next[key] = sanitizeEvidenceQuestionIds(value);
      return;
    }

    if (key === 'evidence_anchors') {
      const anchors = sanitizeEvidenceAnchors(value);
      const hadAnchors = Array.isArray(value) && value.length > 0;
      if (hadAnchors && anchors.length === 0) {
        next.__drop = true;
        return;
      }
      next[key] = anchors;
      return;
    }

    if (key === 'targets' && value && typeof value === 'object' && !Array.isArray(value)) {
      const targetsSource = value as Record<string, any>;
      const questionIds = sanitizeEvidenceQuestionIds(targetsSource.question_ids);
      const targetAnchors = sanitizeEvidenceAnchors(targetsSource.evidence_anchors);
      const hadTargetAnchors =
        Array.isArray(targetsSource.evidence_anchors) && targetsSource.evidence_anchors.length > 0;
      if (
        toSafeArray(targetsSource.question_ids).some((id) => hasDocAIdentifier(id)) ||
        (hadTargetAnchors && targetAnchors.length === 0)
      ) {
        next.__drop = true;
        return;
      }
      next[key] = {
        ...targetsSource,
        question_ids: questionIds,
        evidence_anchors: targetAnchors,
      };
      return;
    }

    if (typeof value === 'string') {
      const scrubbed = scrubString(value, markers, '');
      next[key] = scrubbed;
      return;
    }

    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      next[key] = scrubStringArray(value, markers);
      return;
    }

    next[key] = value;
  });

  if (next.__drop) {
    return null;
  }
  delete next.__drop;

  if (containsConfidentialMarker(JSON.stringify(next), markers)) {
    return null;
  }

  return next;
}

function sanitizeEvidenceEntryArray(value: unknown, markers: string[]) {
  return toSafeArray(value)
    .map((entry) => sanitizeEvidenceEntry(entry, markers))
    .filter(Boolean);
}

function sanitizeFieldDigest(value: unknown, markers: string[]) {
  const digest = toSafeArray(value)
    .map((entry) => sanitizeEvidenceEntry(entry, markers))
    .filter(Boolean)
    .filter((entry) => {
      const party = String(entry?.party || '').trim().toLowerCase();
      return party !== 'a';
    })
    .map((entry) => ({
      question_id: scrubString(entry.question_id, markers, 'doc_b_visible'),
      label: scrubString(entry.label, markers, SHARED_LABEL),
      party: 'b',
      value_summary: scrubString(entry.value_summary, markers, ''),
      visibility: scrubString(entry.visibility, markers, 'full') || 'full',
      verified_status: scrubString(entry.verified_status, markers, 'unknown') || 'unknown',
      last_updated_by: scrubString(entry.last_updated_by, markers, 'recipient') || 'recipient',
    }))
    .filter((entry) => Boolean(entry.value_summary));

  if (digest.length > 0) {
    return digest;
  }

  return [
    {
      question_id: 'doc_b_visible',
      label: SHARED_LABEL,
      party: 'b',
      value_summary: 'Shared information was used to generate this recipient-safe report.',
      visibility: 'full',
      verified_status: 'self_declared',
      last_updated_by: 'system',
    },
  ];
}

function sanitizeLegacySections(value: unknown, markers: string[]) {
  const sections = toSafeArray(value)
    .map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        return null;
      }
      const key = scrubString((section as any).key, markers, '');
      const heading = scrubString((section as any).heading, markers, '');
      const bullets = scrubStringArray((section as any).bullets, markers).filter(
        (bullet) => !hasDocAIdentifier(bullet) && !/confidential information/i.test(bullet),
      );

      if (!heading && bullets.length === 0) {
        return null;
      }

      return {
        key: key || 'summary',
        heading: heading || 'Recipient-Safe Summary',
        bullets,
      };
    })
    .filter(Boolean);

  if (sections.length > 0) {
    return sections;
  }

  return [
    {
      key: 'summary',
      heading: 'Recipient-Safe Summary',
      bullets: ['Evaluation generated from Shared Information only.'],
    },
  ];
}

function redactConfidentialStrings(value: any, markers: string[]): any {
  if (typeof value === 'string') {
    if (!containsConfidentialMarker(value, markers)) {
      return value;
    }
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => redactConfidentialStrings(entry, markers))
      .filter((entry) => {
        if (typeof entry === 'string') {
          return entry.trim().length > 0;
        }
        return entry !== null && entry !== undefined;
      });
  }

  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, entry]) => {
      next[key] = redactConfidentialStrings(entry, markers);
    });
    return next;
  }

  return value;
}

function hasLeakAfterProjection(payload: any, markers: string[]) {
  if (!markers.length) {
    return false;
  }
  return containsConfidentialMarker(JSON.stringify(payload || {}), markers);
}

function toRecommendation(value: unknown, scoreFallback = 0): 'High' | 'Medium' | 'Low' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'low') return 'Low';

  const score = clampScore(scoreFallback, 0);
  if (score >= 75) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}

function buildFallbackRecipientReport(params: {
  title: string;
  generatedAt: string;
  score: number;
  confidence: number;
  recommendation: 'High' | 'Medium' | 'Low';
}) {
  const confidenceRatio = clampConfidence(params.confidence, 0.35);
  const summaryScore = clampScore(params.score, 0);
  return {
    template_id: 'document_comparison_template',
    template_name: params.title || 'Document Comparison',
    generated_at_iso: params.generatedAt,
    parties: {
      a_label: CONFIDENTIAL_LABEL,
      b_label: SHARED_LABEL,
    },
    quality: {
      completeness_a: 0,
      completeness_b: 0,
      confidence_overall: confidenceRatio,
      confidence_reasoning: ['Recipient-safe projection excludes confidential evidence.'],
      missing_high_impact_question_ids: [],
      disputed_question_ids: [],
    },
    summary: {
      overall_score_0_100: summaryScore,
      fit_level: params.recommendation.toLowerCase(),
      top_fit_reasons: [
        {
          text: 'Shared Information provided enough visible context for a limited recipient-safe summary.',
          evidence_question_ids: ['doc_b_visible'],
          evidence_anchors: [],
        },
      ],
      top_blockers: [],
      next_actions: ['Review Shared Information details and request clarification where needed.'],
    },
    category_breakdown: [],
    gates: [],
    overlaps_and_constraints: [],
    contradictions: [],
    flags: [],
    verification: {
      summary: {
        self_declared_count: 0,
        evidence_attached_count: 0,
        tier1_verified_count: 0,
        disputed_count: 0,
      },
      evidence_requested: [],
    },
    followup_questions: [],
    appendix: {
      field_digest: [
        {
          question_id: 'doc_b_visible',
          label: SHARED_LABEL,
          party: 'b',
          value_summary: 'Shared information reviewed for recipient-safe reporting.',
          visibility: 'full',
          verified_status: 'self_declared',
          last_updated_by: 'system',
        },
      ],
    },
    generated_at: params.generatedAt,
    recommendation: params.recommendation,
    confidence_score: Math.round(confidenceRatio * 100),
    similarity_score: summaryScore,
    delta_characters: 0,
    confidentiality_spans: 0,
    executive_summary: 'Recipient-safe evaluation generated from Shared Information only.',
    sections: [
      {
        key: 'summary',
        heading: 'Recipient-Safe Summary',
        bullets: ['Confidential Information is excluded from recipient-facing report payloads.'],
      },
    ],
    provider: 'projection',
    model: 'recipient-safe',
  };
}

export function buildRecipientSafeEvaluationProjection(params: {
  evaluationResult: unknown;
  publicReport?: unknown;
  confidentialText?: string;
  sharedText?: string;
  title?: string;
}) {
  const evaluation = toSafeObject(params?.evaluationResult);
  const sourceReport = toSafeObject(params?.publicReport || evaluation.report);
  const generatedAt =
    scrubString(evaluation.generatedAt, [], '') ||
    scrubString(sourceReport.generated_at_iso, [], '') ||
    new Date().toISOString();
  const markers = collectConfidentialMarkers(String(params?.confidentialText || ''));

  const score = clampScore(
    evaluation.score,
    clampScore(sourceReport.similarity_score, clampScore(sourceReport.summary?.overall_score_0_100, 0)),
  );
  const confidence = clampScore(
    evaluation.confidence,
    clampScore(toNumber(sourceReport.confidence_score, toNumber(sourceReport.quality?.confidence_overall, 0.35) * 100), 35),
  );
  const recommendation = toRecommendation(evaluation.recommendation || sourceReport.recommendation, score);

  const topFitReasons = sanitizeEvidenceEntryArray(sourceReport.summary?.top_fit_reasons, markers);
  const topBlockers = sanitizeEvidenceEntryArray(sourceReport.summary?.top_blockers, markers);
  const nextActions = scrubStringArray(sourceReport.summary?.next_actions, markers);

  const safeReport = {
    template_id: scrubString(sourceReport.template_id, markers, 'document_comparison_template'),
    template_name: scrubString(
      sourceReport.template_name || params?.title,
      markers,
      scrubString(params?.title, markers, 'Document Comparison'),
    ),
    generated_at_iso: generatedAt,
    parties: {
      a_label: CONFIDENTIAL_LABEL,
      b_label: SHARED_LABEL,
    },
    quality: {
      completeness_a: clampRatio(sourceReport.quality?.completeness_a, 0),
      completeness_b: clampRatio(sourceReport.quality?.completeness_b, 0),
      confidence_overall: clampConfidence(sourceReport.quality?.confidence_overall, confidence / 100),
      confidence_reasoning: scrubStringArray(sourceReport.quality?.confidence_reasoning, markers),
      missing_high_impact_question_ids: sanitizeEvidenceQuestionIds(
        sourceReport.quality?.missing_high_impact_question_ids,
      ),
      disputed_question_ids: sanitizeEvidenceQuestionIds(sourceReport.quality?.disputed_question_ids),
    },
    summary: {
      overall_score_0_100: clampScore(
        sourceReport.summary?.overall_score_0_100,
        score,
      ),
      fit_level: scrubString(
        sourceReport.summary?.fit_level,
        markers,
        recommendation.toLowerCase(),
      ),
      top_fit_reasons:
        topFitReasons.length > 0
          ? topFitReasons
          : [
              {
                text: 'Shared Information provides the basis for this recipient-safe fit summary.',
                evidence_question_ids: ['doc_b_visible'],
                evidence_anchors: [],
              },
            ],
      top_blockers: topBlockers,
      next_actions:
        nextActions.length > 0
          ? nextActions
          : ['Review Shared Information and request clarification for unresolved risk areas.'],
    },
    category_breakdown: sanitizeEvidenceEntryArray(sourceReport.category_breakdown, markers),
    gates: sanitizeEvidenceEntryArray(sourceReport.gates, markers),
    overlaps_and_constraints: sanitizeEvidenceEntryArray(sourceReport.overlaps_and_constraints, markers),
    contradictions: sanitizeEvidenceEntryArray(sourceReport.contradictions, markers),
    flags: sanitizeEvidenceEntryArray(sourceReport.flags, markers),
    verification: {
      summary: {
        self_declared_count: Math.max(0, Math.floor(toNumber(sourceReport.verification?.summary?.self_declared_count, 0))),
        evidence_attached_count: Math.max(
          0,
          Math.floor(toNumber(sourceReport.verification?.summary?.evidence_attached_count, 0)),
        ),
        tier1_verified_count: Math.max(
          0,
          Math.floor(toNumber(sourceReport.verification?.summary?.tier1_verified_count, 0)),
        ),
        disputed_count: Math.max(0, Math.floor(toNumber(sourceReport.verification?.summary?.disputed_count, 0))),
      },
      evidence_requested: sanitizeEvidenceEntryArray(sourceReport.verification?.evidence_requested, markers),
    },
    followup_questions: sanitizeEvidenceEntryArray(sourceReport.followup_questions, markers),
    appendix: {
      field_digest: sanitizeFieldDigest(sourceReport.appendix?.field_digest, markers),
    },
    generated_at: generatedAt,
    recommendation,
    confidence_score: confidence,
    similarity_score: clampScore(sourceReport.similarity_score, score),
    delta_characters: Math.max(0, Math.floor(toNumber(sourceReport.delta_characters, 0))),
    confidentiality_spans: 0,
    executive_summary:
      scrubString(
        sourceReport.executive_summary || evaluation.summary,
        markers,
        '',
      ) || 'Recipient-safe evaluation generated from Shared Information only.',
    sections: sanitizeLegacySections(sourceReport.sections, markers),
    provider: scrubString(sourceReport.provider || evaluation.provider, markers, 'projection'),
    model: scrubString(sourceReport.model || evaluation.model, markers, 'recipient-safe'),
  } as Record<string, any>;

  const projectedReport = redactConfidentialStrings(safeReport, markers);
  const projectionHasLeak = hasLeakAfterProjection(projectedReport, markers);
  const fallbackReport = buildFallbackRecipientReport({
    title: scrubString(params?.title, markers, 'Document Comparison'),
    generatedAt,
    score,
    confidence: confidence / 100,
    recommendation,
  });
  const finalReport = projectionHasLeak ? fallbackReport : projectedReport;
  const summary =
    scrubString(
      evaluation.summary || finalReport.executive_summary,
      markers,
      '',
    ) || 'Recipient-safe evaluation generated from Shared Information only.';

  const recipientEvaluation = {
    provider: scrubString(evaluation.provider, markers, 'projection'),
    model: scrubString(evaluation.model, markers, 'recipient-safe'),
    generatedAt,
    score,
    confidence,
    recommendation,
    summary,
    report: finalReport,
  };

  if (hasLeakAfterProjection(recipientEvaluation, markers)) {
    return {
      evaluation_result: {
        provider: 'projection',
        model: 'recipient-safe',
        generatedAt,
        score,
        confidence,
        recommendation,
        summary: 'Recipient-safe evaluation generated from Shared Information only.',
        report: fallbackReport,
      },
      public_report: fallbackReport,
    };
  }

  return {
    evaluation_result: recipientEvaluation,
    public_report: finalReport,
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

  return Math.min(Math.max(Math.floor(numeric), 1), 3);
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
  const confidentialityCount = 0;

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
        key: 'information_scope',
        heading: 'Information Scope',
        bullets: [
          `${CONFIDENTIAL_LABEL} is private and kept out of recipient-facing payloads.`,
          `${SHARED_LABEL} is the only recipient-facing document.`,
          `Confidential span model: disabled`,
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
