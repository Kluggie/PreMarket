import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { toQuestionLookup, toRecipientEditableQuestionIds, validateShareLinkAccess } from './_utils/sharedLink.ts';

const PARTY_A_KEYS = new Set(['a', 'party_a', 'proposer']);
const PARTY_B_KEYS = new Set(['b', 'party_b', 'recipient', 'counterparty']);
const RECEIVED_RECORD_ACTION = 'shared_proposal_received';
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

function logInfo(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', ...payload }));
}

function logWarn(payload: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: 'warn', ...payload }));
}

const normalizeParty = (party: unknown) => String(party || 'a').toLowerCase();
const isPartyAResponse = (response: any) => PARTY_A_KEYS.has(normalizeParty(response?.entered_by_party || response?.author_party));
const isPartyBResponse = (response: any) => PARTY_B_KEYS.has(normalizeParty(response?.entered_by_party || response?.author_party));

function objectData(source: any) {
  return source?.data && typeof source.data === 'object' ? source.data : {};
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

function parseObjectField(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function extractProposalId(source: any): string | null {
  if (!source || typeof source !== 'object') return null;
  const data = objectData(source);
  return (
    source.proposal_id ||
    source.linked_proposal_id ||
    source.proposalId ||
    source.linkedProposalId ||
    data.proposal_id ||
    data.proposalId ||
    null
  );
}

function extractShareLinkProposalId(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;

  const context = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
  const data = shareLink.data && typeof shareLink.data === 'object' ? shareLink.data : {};
  const metadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};

  return (
    asString(shareLink.proposalId) ||
    asString(shareLink.proposal_id) ||
    asString(shareLink.linkedProposalId) ||
    asString(shareLink.linked_proposal_id) ||
    asString(context.proposalId) ||
    asString(context.proposal_id) ||
    asString(context.linkedProposalId) ||
    asString(context.linked_proposal_id) ||
    asString(data.proposalId) ||
    asString(data.proposal_id) ||
    asString(data.linkedProposalId) ||
    asString(data.linked_proposal_id) ||
    asString(metadata.proposalId) ||
    asString(metadata.proposal_id) ||
    asString(metadata.linkedProposalId) ||
    asString(metadata.linked_proposal_id) ||
    null
  );
}

function safeKeyList(source: unknown): string[] {
  if (!source || typeof source !== 'object') return [];
  return Object.keys(source as Record<string, unknown>).sort();
}

function extractReportPayload(source: any) {
  if (!source || typeof source !== 'object') return null;
  const data = objectData(source);
  return (
    source.output_report_json ||
    source.evaluation_report_json ||
    source.public_report_json ||
    source.report ||
    data.output_report_json ||
    data.evaluation_report_json ||
    data.public_report_json ||
    data.report ||
    null
  );
}

function extractGeneratedAt(source: any) {
  if (!source || typeof source !== 'object') return null;
  const data = objectData(source);
  return source.generated_at || source.created_date || data.generated_at || data.created_date || null;
}

function parseConsumeView(req: Request, body: any): boolean {
  if (typeof body?.consumeView === 'boolean') return body.consumeView;
  const fromQuery = new URL(req.url).searchParams.get('consumeView');
  if (fromQuery === null) return true;
  return fromQuery !== 'false';
}

function statusLabel(statusCode: number): 'ok' | 'not_found' | 'forbidden' | 'expired' | 'auth_required' | 'invalid' {
  if (statusCode === 404) return 'not_found';
  if (statusCode === 401) return 'auth_required';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 410) return 'expired';
  if (statusCode >= 400) return 'invalid';
  return 'ok';
}

const buildRecipientProposalView = (proposal: any) => {
  if (!proposal) return null;

  return {
    id: proposal.id,
    title: proposal.title || 'Untitled Proposal',
    template_name: proposal.template_name || null,
    template_id: proposal.template_id || null,
    status: proposal.status || null,
    created_date: proposal.created_date || null,
    sent_at: proposal.sent_at || null,
    document_comparison_id: proposal.document_comparison_id || null,
    party_a_email: 'Identity Protected',
    party_b_email: proposal.party_b_email || null,
    mutual_reveal: false,
    reveal_requested_by_a: false,
    reveal_requested_by_b: Boolean(proposal.reveal_requested_by_b),
    reveal_level_a: null,
    reveal_level_b: proposal.reveal_level_b || null
  };
};

function redactPartyAResponseValue(response: any) {
  const visibility = String(response?.visibility || 'full').toLowerCase();
  if (visibility === 'hidden') {
    return {
      value: null,
      rangeMin: null,
      rangeMax: null,
      valueSummary: 'Not shared',
      redaction: 'hidden'
    };
  }

  if (response?.value_type === 'range') {
    if (visibility === 'partial') {
      return {
        value: null,
        rangeMin: null,
        rangeMax: null,
        valueSummary: 'Range shared at high level',
        redaction: 'partial'
      };
    }
    return {
      value: null,
      rangeMin: response?.range_min ?? null,
      rangeMax: response?.range_max ?? null,
      valueSummary: `Range: ${response?.range_min ?? '?'} - ${response?.range_max ?? '?'}`,
      redaction: 'none'
    };
  }

  const rawValue = response?.value ?? null;
  if (visibility === 'partial') {
    const text = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
    const summary = text.length > 48 ? `${text.slice(0, 48)}...` : text;
    return {
      value: null,
      rangeMin: null,
      rangeMax: null,
      valueSummary: summary || 'Partially shared',
      redaction: 'partial'
    };
  }

  return {
    value: rawValue,
    rangeMin: response?.range_min ?? null,
    rangeMax: response?.range_max ?? null,
    valueSummary: rawValue ?? 'Not provided',
    redaction: 'none'
  };
}

function buildPartyAResponseView(response: any, questionLookup: Record<string, any>) {
  const questionId = response?.question_id || '';
  const question = questionLookup?.[questionId] || null;
  const redacted = redactPartyAResponseValue(response);

  return {
    id: response?.id || null,
    questionId,
    label: question?.label || questionId,
    valueType: response?.value_type || (redacted.rangeMin !== null || redacted.rangeMax !== null ? 'range' : 'text'),
    visibility: response?.visibility || 'full',
    enteredByParty: response?.entered_by_party || null,
    value: redacted.value,
    rangeMin: redacted.rangeMin,
    rangeMax: redacted.rangeMax,
    valueSummary: redacted.valueSummary,
    redaction: redacted.redaction,
    createdAt: response?.created_date || null
  };
}

function buildRecipientResponseView(response: any) {
  const hidden = normalizeVisibility(response?.visibility) === 'hidden';

  return {
    id: response?.id || null,
    proposal_id: response?.proposal_id || null,
    question_id: response?.question_id || '',
    value_type: response?.value_type || null,
    entered_by_party: response?.entered_by_party || null,
    visibility: hidden ? 'not_shared' : (response?.visibility || 'full'),
    value: hidden ? null : (response?.value ?? null),
    range_min: hidden ? null : (response?.range_min ?? null),
    range_max: hidden ? null : (response?.range_max ?? null),
    created_date: response?.created_date || null
  };
}

function normalizeVisibility(value: unknown): 'full' | 'hidden' {
  const normalized = String(value || '').trim().toLowerCase();
  if (['hidden', 'not_shared', 'private', 'confidential', 'partial'].includes(normalized)) {
    return 'hidden';
  }
  return 'full';
}

function inferSubjectParty(question: any, fromKey: string | null): 'a' | 'b' | 'shared' {
  const normalizedFromKey = String(fromKey || '').trim().toLowerCase();
  if (normalizedFromKey === 'b' || normalizedFromKey === 'party_b' || normalizedFromKey === 'recipient') return 'b';
  if (normalizedFromKey === 'shared') return 'shared';
  if (normalizedFromKey === 'a' || normalizedFromKey === 'party_a' || normalizedFromKey === 'proposer') return 'a';

  const party = String(
    question?.party ||
    question?.party_key ||
    question?.subject_party ||
    question?.for_party ||
    ''
  ).toLowerCase();
  if (party === 'b' || party === 'party_b' || party === 'recipient' || party === 'counterparty') return 'b';
  if (party === 'shared') return 'shared';

  const roleType = String(question?.role_type || '').toLowerCase();
  if (roleType === 'shared_fact') return 'shared';
  if (roleType === 'counterparty_observation') return 'b';

  if (question?.is_about_counterparty === true) return 'b';
  if (String(question?.applies_to_role || '').toLowerCase() === 'recipient') return 'b';
  return 'a';
}

function toFallbackResponseValue(rawValue: unknown): { valueType: 'text' | 'range'; value: string | null; rangeMin: number | null; rangeMax: number | null } {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const type = String((rawValue as Record<string, unknown>).type || '').toLowerCase();
    if (type === 'range') {
      const minRaw = Number((rawValue as Record<string, unknown>).min);
      const maxRaw = Number((rawValue as Record<string, unknown>).max);
      return {
        valueType: 'range',
        value: null,
        rangeMin: Number.isFinite(minRaw) ? minRaw : null,
        rangeMax: Number.isFinite(maxRaw) ? maxRaw : null
      };
    }
    return {
      valueType: 'text',
      value: JSON.stringify(rawValue),
      rangeMin: null,
      rangeMax: null
    };
  }

  if (Array.isArray(rawValue)) {
    return {
      valueType: 'text',
      value: JSON.stringify(rawValue),
      rangeMin: null,
      rangeMax: null
    };
  }

  if (rawValue === null || rawValue === undefined) {
    return {
      valueType: 'text',
      value: '',
      rangeMin: null,
      rangeMax: null
    };
  }

  return {
    valueType: 'text',
    value: String(rawValue),
    rangeMin: null,
    rangeMax: null
  };
}

function buildFallbackResponsesFromStepState(stepState: any, questionLookup: Record<string, any>, proposalId: string) {
  const rawResponses = stepState?.responses;
  const rawVisibility = stepState?.visibilitySettings && typeof stepState.visibilitySettings === 'object'
    ? stepState.visibilitySettings
    : {};

  if (!rawResponses || typeof rawResponses !== 'object') return [];

  const rows: any[] = [];
  const seen = new Set<string>();

  for (const [responseKey, rawValue] of Object.entries(rawResponses as Record<string, unknown>)) {
    if (responseKey.startsWith('_')) continue;

    const [questionId, subjectFromKey] = responseKey.includes('__')
      ? responseKey.split('__')
      : [responseKey, null];

    if (!questionId) continue;
    const question = questionLookup[questionId] || null;
    const subjectParty = inferSubjectParty(question, subjectFromKey);
    const dedupeKey = `${questionId}__${subjectParty}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const visibility = subjectParty === 'b'
      ? 'full'
      : normalizeVisibility(
          (rawVisibility as Record<string, unknown>)[responseKey] ??
          (rawVisibility as Record<string, unknown>)[questionId]
        );

    const parsed = toFallbackResponseValue(rawValue);

    rows.push({
      id: `fallback_${proposalId}_${dedupeKey}`,
      proposal_id: proposalId,
      question_id: questionId,
      entered_by_party: subjectParty === 'b' ? 'a' : 'a',
      author_party: subjectParty === 'b' ? 'a' : 'a',
      subject_party: subjectParty,
      is_about_counterparty: subjectParty === 'b',
      value_type: parsed.valueType,
      value: parsed.value,
      range_min: parsed.rangeMin,
      range_max: parsed.rangeMax,
      visibility,
      created_date: null
    });
  }

  return rows;
}

function normalizeEnteredByParty(value: unknown): 'a' | 'b' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'b' || normalized === 'party_b' || normalized === 'recipient' || normalized === 'counterparty') {
    return 'b';
  }
  return 'a';
}

function buildFallbackResponsesFromInputSnapshot(inputSnapshot: any, questionLookup: Record<string, any>, proposalId: string) {
  const rawResponses = inputSnapshot?.responses;
  if (!Array.isArray(rawResponses)) return [];

  const rows: any[] = [];
  const seen = new Set<string>();

  rawResponses.forEach((rawItem: any, index: number) => {
    const questionId = asString(rawItem?.question_id || rawItem?.questionId);
    if (!questionId) return;

    const question = questionLookup[questionId] || null;
    const enteredByParty = normalizeEnteredByParty(rawItem?.party || rawItem?.entered_by_party || rawItem?.enteredByParty);
    const subjectParty = inferSubjectParty(question, null);
    const dedupeKey = `${questionId}__${enteredByParty}__${subjectParty}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const valueType = String(rawItem?.value_type || rawItem?.valueType || '').toLowerCase();
    const parsed = valueType === 'range'
      ? {
          valueType: 'range' as const,
          value: null,
          rangeMin: Number.isFinite(Number(rawItem?.range_min ?? rawItem?.rangeMin))
            ? Number(rawItem?.range_min ?? rawItem?.rangeMin)
            : null,
          rangeMax: Number.isFinite(Number(rawItem?.range_max ?? rawItem?.rangeMax))
            ? Number(rawItem?.range_max ?? rawItem?.rangeMax)
            : null
        }
      : toFallbackResponseValue(rawItem?.value);

    rows.push({
      id: `snapshot_${proposalId}_${index}_${questionId}`,
      proposal_id: proposalId,
      question_id: questionId,
      entered_by_party: enteredByParty,
      author_party: enteredByParty,
      subject_party: subjectParty,
      is_about_counterparty: subjectParty === 'b',
      value_type: parsed.valueType,
      value: parsed.value,
      range_min: parsed.rangeMin,
      range_max: parsed.rangeMax,
      visibility: normalizeVisibility(rawItem?.visibility),
      created_date: null
    });
  });

  return rows;
}

function normalizeComparisonLevel(level: unknown): 'hidden' | null {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'hidden' || normalized === 'confidential' || normalized === 'partial') return 'hidden';
  return null;
}

function normalizeComparisonSpans(spans: unknown, textLength: number): Array<{ start: number; end: number; level: 'hidden' }> {
  if (!Array.isArray(spans)) return [];

  return spans
    .map((span: any) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeComparisonLevel(span?.level);

      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;

      const start = Math.max(0, Math.min(rawStart, textLength));
      const end = Math.max(0, Math.min(rawEnd, textLength));
      if (end <= start) return null;

      return { start, end, level };
    })
    .filter((span): span is { start: number; end: number; level: 'hidden' } => Boolean(span))
    .sort((a, b) => a.start - b.start);
}

function removeHiddenComparisonText(text: string, spans: unknown) {
  const normalizedSpans = normalizeComparisonSpans(spans, text.length);
  if (normalizedSpans.length === 0) {
    return {
      text,
      hiddenCount: 0
    };
  }

  let output = '';
  let cursor = 0;

  for (const span of normalizedSpans) {
    if (span.start > cursor) {
      output += text.slice(cursor, span.start);
    }
    cursor = Math.max(cursor, span.end);
  }

  if (cursor < text.length) {
    output += text.slice(cursor);
  }

  return {
    text: output,
    hiddenCount: normalizedSpans.length
  };
}

function buildComparisonView(documentComparison: any) {
  if (!documentComparison || typeof documentComparison !== 'object') return null;

  const data = objectData(documentComparison);

  const rawDocAText = String(
    documentComparison.doc_a_plaintext ??
    data.doc_a_plaintext ??
    ''
  );
  const rawDocBText = String(
    documentComparison.doc_b_plaintext ??
    data.doc_b_plaintext ??
    ''
  );
  const rawDocASpans = Array.isArray(documentComparison.doc_a_spans_json)
    ? documentComparison.doc_a_spans_json
    : (Array.isArray(data.doc_a_spans_json) ? data.doc_a_spans_json : []);
  const rawDocBSpans = Array.isArray(documentComparison.doc_b_spans_json)
    ? documentComparison.doc_b_spans_json
    : (Array.isArray(data.doc_b_spans_json) ? data.doc_b_spans_json : []);

  const redactedDocA = removeHiddenComparisonText(rawDocAText, rawDocASpans);
  const redactedDocB = removeHiddenComparisonText(rawDocBText, rawDocBSpans);

  return {
    id: asString(documentComparison.id),
    title: asString(documentComparison.title) || asString(data.title) || null,
    docA: {
      label: asString(documentComparison.party_a_label) || asString(data.party_a_label) || 'Document A',
      source: asString(documentComparison.doc_a_source) || asString(data.doc_a_source) || 'typed',
      text: redactedDocA.text,
      hiddenCount: redactedDocA.hiddenCount
    },
    docB: {
      label: asString(documentComparison.party_b_label) || asString(data.party_b_label) || 'Document B',
      source: asString(documentComparison.doc_b_source) || asString(data.doc_b_source) || 'typed',
      text: redactedDocB.text,
      hiddenCount: redactedDocB.hiddenCount
    }
  };
}

function buildPartyBEditableSchema(template: any, proposalResponses: any[]) {
  const questionLookup = toQuestionLookup(template);
  const questionIds = toRecipientEditableQuestionIds(template);

  const questions = questionIds.map((questionId) => {
    const question = questionLookup[questionId] || {};

    const recipientResponse =
      proposalResponses.find((response) => response?.question_id === questionId && isPartyBResponse(response)) ||
      proposalResponses.find((response) => {
        if (response?.question_id !== questionId) return false;
        const subjectParty = String(response?.subject_party || '').toLowerCase();
        return subjectParty === 'b' || subjectParty === 'party_b' || response?.is_about_counterparty === true;
      }) ||
      null;

    return {
      questionId,
      label: question?.label || questionId,
      description: question?.description || null,
      moduleKey: question?.module_key || null,
      fieldType: question?.field_type || 'text',
      valueType: recipientResponse?.value_type || null,
      required: Boolean(question?.required),
      supportsVisibility: Boolean(question?.supports_visibility),
      allowedValues: Array.isArray(question?.allowed_values) ? question.allowed_values : [],
      currentResponse: {
        id: recipientResponse?.id || null,
        value: recipientResponse?.value ?? null,
        rangeMin: recipientResponse?.range_min ?? null,
        rangeMax: recipientResponse?.range_max ?? null,
        visibility: recipientResponse?.visibility || 'full',
        enteredByParty: recipientResponse?.entered_by_party || null,
        updatedAt: recipientResponse?.updated_date || recipientResponse?.created_date || null
      }
    };
  });

  return {
    totalQuestions: questions.length,
    editableQuestionIds: questionIds,
    questions
  };
}

function pickLatestReportCandidate(records: any[], sourceName: string) {
  const candidate = records?.[0] || null;
  const data = objectData(candidate);
  return {
    source: sourceName,
    payload: extractReportPayload(candidate),
    generatedAt: extractGeneratedAt(candidate),
    id: asString(candidate?.id),
    inputSnapshot: candidate?.input_snapshot_json || data?.input_snapshot_json || null
  };
}

function dedupeById(records: any[]) {
  const byId = new Map<string, any>();
  records.forEach((record, index) => {
    const id = asString(record?.id) || `fallback_${index}`;
    if (!byId.has(id)) {
      byId.set(id, record);
    }
  });
  return Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a?.created_date || a?.updated_date || 0).getTime();
    const bTime = new Date(b?.created_date || b?.updated_date || 0).getTime();
    return bTime - aTime;
  });
}

function extractReceivedProposalId(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  const details = parseObjectField(row?.details);
  return asString(
    row?.entity_id ||
    row?.proposal_id ||
    row?.proposalId ||
    details?.proposal_id ||
    details?.proposalId ||
    details?.linked_proposal_id ||
    details?.linkedProposalId ||
    null
  );
}

async function ensureReceivedProposalRecord(
  base44: any,
  {
    proposalId,
    proposal,
    shareLink,
    currentUser
  }: {
    proposalId: string | null;
    proposal: any;
    shareLink: any;
    currentUser: any;
  }
) {
  const normalizedProposalId = asString(proposalId);
  const recipientUserId = asString(currentUser?.id);
  const recipientEmail = normalizeEmail(currentUser?.email);
  if (!normalizedProposalId || !recipientUserId || !recipientEmail) {
    return {
      ensured: false,
      created: false,
      recordId: null
    };
  }

  const existingRows = await base44.asServiceRole.entities.AuditLog
    .filter({ user_id: recipientUserId, action: RECEIVED_RECORD_ACTION }, '-created_date', 200)
    .catch(() => []);

  const existingRecord = existingRows.find((row: any) => {
    return extractReceivedProposalId(row) === normalizedProposalId;
  }) || null;
  const existingDetails = parseObjectField(existingRecord?.details);
  const openedAt = new Date().toISOString();

  const payload = {
    entity_type: 'Proposal',
    entity_id: normalizedProposalId,
    user_id: recipientUserId,
    user_email: recipientEmail,
    action: RECEIVED_RECORD_ACTION,
    details: {
      proposalId: normalizedProposalId,
      proposal_id: normalizedProposalId,
      proposalTitle: asString(proposal?.title) || null,
      templateName: asString(proposal?.template_name) || null,
      partyAEmail: normalizeEmail(proposal?.party_a_email),
      senderEmail: normalizeEmail(proposal?.party_a_email),
      recipientEmail,
      token: asString(shareLink?.token),
      shareLinkId: asString(shareLink?.id),
      source: 'shared_link_open',
      openedAt,
      firstOpenedAt: asString(existingDetails?.firstOpenedAt) || existingRecord?.created_date || openedAt
    }
  };

  if (existingRecord?.id) {
    await base44.asServiceRole.entities.AuditLog.update(existingRecord.id, payload);
    console.log('ensureReceived: exists', JSON.stringify({
      proposalId: normalizedProposalId,
      recipientUserId
    }));
    return {
      ensured: true,
      created: false,
      recordId: existingRecord.id
    };
  }

  const created = await base44.asServiceRole.entities.AuditLog.create(payload);
  console.log('ensureReceived: created', JSON.stringify({
    proposalId: normalizedProposalId,
    recipientUserId
  }));
  return {
    ensured: true,
    created: true,
    recordId: asString(created?.id)
  };
}

Deno.serve(async (req) => {
  const correlationId = `shared_resolve_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const token = asString(body?.token) || asString(new URL(req.url).searchParams.get('token'));
    const consumeView = parseConsumeView(req, body);

    if (!token) {
      return respond({
        ok: false,
        status: 'invalid',
        code: 'MISSING_TOKEN',
        reason: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, 400);
    }

    const validation = await validateShareLinkAccess(base44, { token, consumeView });

    if (!validation.ok) {
      const payload = {
        ok: false,
        status: statusLabel(validation.statusCode),
        code: validation.code,
        reason: validation.reason,
        message: validation.message,
        shareLink: validation.shareLink || null,
        permissions: validation.permissions || null,
        matchedRecipient: validation.matchedRecipient,
        currentUserEmail: validation.currentUserEmail,
        consumedView: false,
        correlationId
      };

      logWarn({
        correlationId,
        event: 'shared_report_denied',
        statusCode: validation.statusCode,
        code: validation.code,
        tokenPrefix: token.slice(0, 8)
      });

      return respond(payload, validation.statusCode);
    }

    const { shareLink, permissions } = validation;
    let evaluationItem: any = null;
    let documentComparison: any = null;
    let resolvedProposalId = extractShareLinkProposalId(shareLink);

    if (shareLink.evaluationItemId) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: shareLink.evaluationItemId }, '-created_date', 1);
      evaluationItem = items?.[0] || null;
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(evaluationItem);
      }
    }

    if (shareLink.documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ id: shareLink.documentComparisonId }, '-created_date', 1);
      documentComparison = comparisons?.[0] || null;
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(documentComparison);
      }
    }

    if (!resolvedProposalId) {
      const shareLinkAny = shareLink as any;
      logWarn({
        correlationId,
        event: 'shared_report_missing_proposal',
        shareLinkId: shareLink.id,
        shareLinkProposalId: shareLink.proposalId,
        shareLinkProposalIdSnake: shareLinkAny?.proposal_id || null,
        shareLinkLinkedProposalId: shareLinkAny?.linkedProposalId || shareLinkAny?.linked_proposal_id || null,
        shareLinkKeys: safeKeyList(shareLink),
        shareLinkContextKeys: safeKeyList(shareLinkAny?.context),
        shareLinkDataKeys: safeKeyList(shareLinkAny?.data),
        shareLinkMetadataKeys: safeKeyList(shareLinkAny?.metadata),
        evaluationItemId: shareLink.evaluationItemId,
        documentComparisonId: shareLink.documentComparisonId
      });
      return respond({
        ok: false,
        status: 'not_found',
        code: 'PROPOSAL_LINK_MISSING',
        reason: 'PROPOSAL_LINK_MISSING',
        message: 'Share link is not linked to a proposal',
        shareLink,
        permissions,
        correlationId
      }, 404);
    }

    const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: resolvedProposalId }, '-created_date', 1);
    const proposal = proposals?.[0] || null;

    if (!proposal) {
      logWarn({
        correlationId,
        event: 'shared_report_proposal_not_found',
        resolvedProposalId,
        shareLinkId: shareLink.id
      });
      return respond({
        ok: false,
        status: 'not_found',
        code: 'PROPOSAL_NOT_FOUND',
        reason: 'PROPOSAL_NOT_FOUND',
        message: 'Proposal not found for this shared report',
        shareLink,
        permissions,
        correlationId
      }, 404);
    }

    const currentUser = await base44.auth.me().catch(() => null);
    let receivedRecord = {
      ensured: false,
      created: false,
      recordId: null as string | null
    };
    try {
      receivedRecord = await ensureReceivedProposalRecord(base44, {
        proposalId: resolvedProposalId,
        proposal,
        shareLink,
        currentUser
      });
    } catch (recordError) {
      const err = recordError instanceof Error ? recordError : new Error(String(recordError));
      logWarn({
        correlationId,
        event: 'shared_received_record_failed',
        proposalId: resolvedProposalId,
        shareLinkId: shareLink?.id || null,
        recipientUserId: asString(currentUser?.id),
        message: err.message
      });
    }

    if (!documentComparison && proposal?.document_comparison_id) {
      const linkedComparisons = await base44.asServiceRole.entities.DocumentComparison.filter(
        { id: proposal.document_comparison_id },
        '-created_date',
        1
      );
      documentComparison = linkedComparisons?.[0] || null;
    }

    if (!documentComparison) {
      const byProposal = await base44.asServiceRole.entities.DocumentComparison.filter(
        { proposal_id: resolvedProposalId },
        '-created_date',
        1
      );
      documentComparison = byProposal?.[0] || null;
    }

    if (!documentComparison) {
      const byProposalInData = await base44.asServiceRole.entities.DocumentComparison.filter(
        { 'data.proposal_id': resolvedProposalId },
        '-created_date',
        1
      );
      documentComparison = byProposalInData?.[0] || null;
    }

    if (!evaluationItem) {
      const itemBuckets = await Promise.all([
        base44.asServiceRole.entities.EvaluationItem.filter({ linked_proposal_id: resolvedProposalId }, '-created_date', 1),
        base44.asServiceRole.entities.EvaluationItem.filter({ linkedProposalId: resolvedProposalId }, '-created_date', 1),
        base44.asServiceRole.entities.EvaluationItem.filter({ 'data.linked_proposal_id': resolvedProposalId }, '-created_date', 1),
        base44.asServiceRole.entities.EvaluationItem.filter({ 'data.linkedProposalId': resolvedProposalId }, '-created_date', 1)
      ]);
      evaluationItem = itemBuckets.flat()?.[0] || null;
    }

    const responseBuckets = await Promise.all([
      base44.asServiceRole.entities.ProposalResponse.filter(
        { proposal_id: resolvedProposalId },
        '-created_date'
      ),
      base44.asServiceRole.entities.ProposalResponse.filter(
        { proposalId: resolvedProposalId },
        '-created_date'
      ),
      base44.asServiceRole.entities.ProposalResponse.filter(
        { 'data.proposal_id': resolvedProposalId },
        '-created_date'
      ),
      base44.asServiceRole.entities.ProposalResponse.filter(
        { 'data.proposalId': resolvedProposalId },
        '-created_date'
      )
    ]);
    let proposalResponses = dedupeById(responseBuckets.flat());

    const templates = await base44.asServiceRole.entities.Template.list();
    const template = templates.find((item: any) => item.id === proposal.template_id) || null;
    const questionLookup = toQuestionLookup(template);
    if (proposalResponses.length === 0 && evaluationItem) {
      const evalData = objectData(evaluationItem);
      const fallbackStepState = evaluationItem.step_state_json || evalData.step_state_json || null;
      if (fallbackStepState) {
        proposalResponses = buildFallbackResponsesFromStepState(fallbackStepState, questionLookup, resolvedProposalId);
      }
    }

    let reportPayload: any = null;
    let reportGeneratedAt: string | null = null;
    let reportId: string | null = null;
    let reportSource = 'none';
    let reportInputSnapshot: any = null;

    const sharedReports = await base44.asServiceRole.entities.EvaluationReportShared.filter(
      { proposal_id: resolvedProposalId },
      '-created_date',
      1
    );
    const sharedCandidate = pickLatestReportCandidate(sharedReports, 'EvaluationReportShared.proposal_id');
    reportPayload = sharedCandidate.payload;
    reportGeneratedAt = sharedCandidate.generatedAt;
    reportId = sharedCandidate.id;
    reportSource = sharedCandidate.payload ? sharedCandidate.source : reportSource;
    reportInputSnapshot = sharedCandidate.inputSnapshot || reportInputSnapshot;

    if (!reportPayload) {
      const reportsByProposal = await base44.asServiceRole.entities.EvaluationReport.filter(
        { proposal_id: resolvedProposalId },
        '-created_date',
        1
      );
      const candidate = pickLatestReportCandidate(reportsByProposal, 'EvaluationReport.proposal_id');
      reportPayload = candidate.payload;
      reportGeneratedAt = candidate.generatedAt || reportGeneratedAt;
      reportId = candidate.id || reportId;
      reportSource = candidate.payload ? candidate.source : reportSource;
      reportInputSnapshot = candidate.inputSnapshot || reportInputSnapshot;
    }

    if (!reportPayload) {
      const reportsByDataProposal = await base44.asServiceRole.entities.EvaluationReport.filter(
        { 'data.proposal_id': resolvedProposalId },
        '-created_date',
        1
      );
      const candidate = pickLatestReportCandidate(reportsByDataProposal, 'EvaluationReport.data.proposal_id');
      reportPayload = candidate.payload;
      reportGeneratedAt = candidate.generatedAt || reportGeneratedAt;
      reportId = candidate.id || reportId;
      reportSource = candidate.payload ? candidate.source : reportSource;
      reportInputSnapshot = candidate.inputSnapshot || reportInputSnapshot;
    }

    if (!reportPayload && documentComparison) {
      reportPayload = extractReportPayload(documentComparison);
      reportGeneratedAt = extractGeneratedAt(documentComparison) || reportGeneratedAt;
      reportId = asString(documentComparison?.id) || reportId;
      reportSource = reportPayload ? 'DocumentComparison' : reportSource;
    }

    if (proposalResponses.length === 0 && reportInputSnapshot) {
      proposalResponses = buildFallbackResponsesFromInputSnapshot(
        reportInputSnapshot,
        questionLookup,
        resolvedProposalId
      );
    }

    const proposalView = buildRecipientProposalView(proposal);
    const responsesView = proposalResponses.map(buildRecipientResponseView);
    const partyAView = {
      proposal: proposalView,
      responses: proposalResponses
        .filter(isPartyAResponse)
        .map((response: any) => buildPartyAResponseView(response, questionLookup))
    };
    const partyBEditableSchema = buildPartyBEditableSchema(template, proposalResponses);
    const comparisonView = buildComparisonView(documentComparison);

    const normalizedShareLink = {
      id: shareLink.id,
      token: shareLink.token,
      proposalId: resolvedProposalId,
      evaluationItemId: shareLink.evaluationItemId || null,
      documentComparisonId: shareLink.documentComparisonId || null,
      recipientEmail: shareLink.recipientEmail,
      createdAt: shareLink.createdAt,
      expiresAt: shareLink.expiresAt,
      uses: shareLink.viewCount,
      maxUses: shareLink.maxViews,
      viewCount: shareLink.viewCount,
      maxViews: shareLink.maxViews,
      mode: shareLink.mode,
      status: shareLink.status,
      lastUsedAt: shareLink.lastUsedAt
    };

    const normalizedPermissions = {
      canView: permissions.canView,
      canEdit: permissions.canEdit,
      canEditRecipientSide: permissions.canEditRecipientSide,
      canReevaluate: permissions.canReevaluate,
      canSendBack: permissions.canSendBack
    };

    const reportData = {
      type: documentComparison ? 'document_comparison' : (evaluationItem?.type || 'proposal'),
      id: resolvedProposalId,
      proposal_id: resolvedProposalId,
      proposalId: resolvedProposalId,
      reportId,
      reportSource,
      evaluationItemId: normalizedShareLink.evaluationItemId,
      documentComparisonId: normalizedShareLink.documentComparisonId || proposal.document_comparison_id || null,
      title: proposal.title || documentComparison?.title || evaluationItem?.title || 'Untitled Proposal',
      template_id: proposal.template_id || null,
      template_name: proposal.template_name || null,
      status: proposal.status || documentComparison?.status || evaluationItem?.status || null,
      party_a_email: 'Identity Protected',
      party_b_email: proposal.party_b_email || evaluationItem?.party_b_email || null,
      created_date: proposal.created_date || documentComparison?.created_date || evaluationItem?.created_date || null,
      generated_at: reportGeneratedAt,
      report: reportPayload,
      comparisonView
    };

    logInfo({
      correlationId,
      event: 'shared_report_resolved',
      shareLinkId: normalizedShareLink.id,
      resolvedProposalId,
      reportId,
      reportSource,
      hasReportPayload: Boolean(reportPayload),
      tokenPrefix: token.slice(0, 8),
      consumedView: validation.consumedView
    });

    return respond({
      ok: true,
      status: 'ok',
      code: 'OK',
      reason: 'OK',
      message: 'Shared report resolved',
      correlationId,
      receivedRecord,
      proposalId: resolvedProposalId,
      reportId,
      evaluationId: normalizedShareLink.evaluationItemId,
      templateId: proposal.template_id || null,
      shareLink: normalizedShareLink,
      permissions: normalizedPermissions,
      reportData,
      comparisonView,
      partyAView,
      partyBEditableSchema,
      proposalView,
      responsesView,
      recipientView: {
        role: 'recipient',
        proposal: proposalView,
        responses: responsesView
      },
      consumedView: validation.consumedView,
      currentUserEmail: validation.currentUserEmail
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return respond({
      ok: false,
      status: 'invalid',
      code: 'INTERNAL_ERROR',
      reason: 'INTERNAL_ERROR',
      message: err.message || 'Failed to load shared report',
      correlationId
    }, 500);
  }
});
