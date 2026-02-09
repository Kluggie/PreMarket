import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { toQuestionLookup, toRecipientEditableQuestionIds, validateShareLinkAccess } from './_utils/sharedLink.ts';

const PARTY_A_KEYS = new Set(['a', 'party_a', 'proposer']);
const PARTY_B_KEYS = new Set(['b', 'party_b', 'recipient', 'counterparty']);
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
  const partyAResponse = isPartyAResponse(response);
  const hidden = partyAResponse || String(response?.visibility || '').toLowerCase() === 'hidden';

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
  return {
    source: sourceName,
    payload: extractReportPayload(candidate),
    generatedAt: extractGeneratedAt(candidate),
    id: asString(candidate?.id)
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

    const proposalResponses = await base44.asServiceRole.entities.ProposalResponse.filter(
      { proposal_id: resolvedProposalId },
      '-created_date'
    );

    const templates = await base44.asServiceRole.entities.Template.list();
    const template = templates.find((item: any) => item.id === proposal.template_id) || null;
    const questionLookup = toQuestionLookup(template);

    let reportPayload: any = null;
    let reportGeneratedAt: string | null = null;
    let reportId: string | null = null;
    let reportSource = 'none';

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
    }

    if (!reportPayload && documentComparison) {
      reportPayload = extractReportPayload(documentComparison);
      reportGeneratedAt = extractGeneratedAt(documentComparison) || reportGeneratedAt;
      reportId = asString(documentComparison?.id) || reportId;
      reportSource = reportPayload ? 'DocumentComparison' : reportSource;
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
      report: reportPayload
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
      proposalId: resolvedProposalId,
      reportId,
      evaluationId: normalizedShareLink.evaluationItemId,
      templateId: proposal.template_id || null,
      shareLink: normalizedShareLink,
      permissions: normalizedPermissions,
      reportData,
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
