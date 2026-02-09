import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PARTY_A_KEYS = new Set(['a', 'party_a', 'proposer']);

const normalizeParty = (party: unknown) => String(party || 'a').toLowerCase();
const isPartyAResponse = (response: any) => PARTY_A_KEYS.has(normalizeParty(response?.entered_by_party));

function logInfo(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', ...payload }));
}

function logWarn(payload: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: 'warn', ...payload }));
}

function objectData(source: any) {
  return source?.data && typeof source.data === 'object' ? source.data : {};
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

function extractReportPayload(source: any) {
  if (!source || typeof source !== 'object') return null;
  const data = objectData(source);
  return (
    source.output_report_json ||
    source.evaluation_report_json ||
    source.report ||
    data.output_report_json ||
    data.evaluation_report_json ||
    data.report ||
    null
  );
}

function extractGeneratedAt(source: any) {
  if (!source || typeof source !== 'object') return null;
  const data = objectData(source);
  return source.generated_at || source.created_date || data.generated_at || data.created_date || null;
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

const buildRecipientResponseView = (response: any) => {
  const partyAResponse = isPartyAResponse(response);

  return {
    id: response?.id || null,
    proposal_id: response?.proposal_id || null,
    question_id: response?.question_id || '',
    value_type: response?.value_type || null,
    entered_by_party: response?.entered_by_party || null,
    visibility: partyAResponse ? 'not_shared' : (response?.visibility || 'full'),
    value: partyAResponse ? null : (response?.value ?? null),
    range_min: partyAResponse ? null : (response?.range_min ?? null),
    range_max: partyAResponse ? null : (response?.range_max ?? null),
    created_date: response?.created_date || null
  };
};

Deno.serve(async (req) => {
  const correlationId = `get_report_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { token } = body;

    if (!token) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }

    const validateResult = await base44.asServiceRole.functions.invoke('ValidateShareLink', { token });
    const validateData = validateResult?.data;

    if (!validateData?.ok) {
      return Response.json({
        ok: false,
        errorCode: validateData?.errorCode || 'INVALID_TOKEN',
        message: validateData?.message || 'Invalid or expired token',
        correlationId
      }, { status: 403 });
    }

    const { shareLink, permissions } = validateData;

    let evaluationItem: any = null;
    let documentComparison: any = null;
    let resolvedProposalId = shareLink?.proposalId || null;

    if (shareLink?.evaluationItemId) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: shareLink.evaluationItemId }, '-created_date', 1);
      evaluationItem = items?.[0] || null;
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(evaluationItem);
      }
    }

    if (shareLink?.documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ id: shareLink.documentComparisonId }, '-created_date', 1);
      documentComparison = comparisons?.[0] || null;
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(documentComparison);
      }
    }

    if (!resolvedProposalId) {
      logWarn({
        correlationId,
        event: 'shared_report_missing_proposal',
        shareLinkId: shareLink?.id || null,
        shareLinkProposalId: shareLink?.proposalId || null,
        evaluationItemId: shareLink?.evaluationItemId || null,
        documentComparisonId: shareLink?.documentComparisonId || null
      });
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL_ID',
        message: 'Share link must be linked to a proposal',
        correlationId
      }, { status: 404 });
    }

    const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: resolvedProposalId }, '-created_date', 1);
    const proposal = proposals?.[0] || null;

    if (!proposal) {
      logWarn({
        correlationId,
        event: 'shared_report_proposal_not_found',
        resolvedProposalId,
        shareLinkId: shareLink?.id || null
      });
      return Response.json({
        ok: false,
        errorCode: 'REPORT_NOT_FOUND',
        message: 'Proposal not found for this shared report',
        correlationId
      }, { status: 404 });
    }

    const proposalResponses = await base44.asServiceRole.entities.ProposalResponse.filter(
      { proposal_id: resolvedProposalId },
      '-created_date'
    );

    let reportPayload: any = null;
    let reportGeneratedAt: string | null = null;

    const sharedReports = await base44.asServiceRole.entities.EvaluationReportShared.filter(
      { proposal_id: resolvedProposalId },
      '-created_date',
      1
    );
    reportPayload = extractReportPayload(sharedReports?.[0]);
    reportGeneratedAt = extractGeneratedAt(sharedReports?.[0]);

    if (!reportPayload) {
      const reportsByProposal = await base44.asServiceRole.entities.EvaluationReport.filter(
        { proposal_id: resolvedProposalId },
        '-created_date',
        1
      );
      reportPayload = extractReportPayload(reportsByProposal?.[0]);
      reportGeneratedAt = reportGeneratedAt || extractGeneratedAt(reportsByProposal?.[0]);
    }

    if (!reportPayload) {
      const reportsByDataProposal = await base44.asServiceRole.entities.EvaluationReport.filter(
        { 'data.proposal_id': resolvedProposalId },
        '-created_date',
        1
      );
      reportPayload = extractReportPayload(reportsByDataProposal?.[0]);
      reportGeneratedAt = reportGeneratedAt || extractGeneratedAt(reportsByDataProposal?.[0]);
    }

    if (!reportPayload && documentComparison) {
      reportPayload = extractReportPayload(documentComparison);
      reportGeneratedAt = reportGeneratedAt || extractGeneratedAt(documentComparison);
    }

    const proposalView = buildRecipientProposalView(proposal);
    const responsesView = proposalResponses.map(buildRecipientResponseView);

    const reportData = {
      type: documentComparison ? 'document_comparison' : (evaluationItem?.type || 'proposal'),
      id: resolvedProposalId,
      proposal_id: resolvedProposalId,
      proposalId: resolvedProposalId,
      evaluationItemId: shareLink?.evaluationItemId || evaluationItem?.id || null,
      documentComparisonId: shareLink?.documentComparisonId || documentComparison?.id || proposal.document_comparison_id || null,
      title: proposal.title || documentComparison?.title || evaluationItem?.title || 'Untitled Proposal',
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
      shareLinkId: shareLink?.id || null,
      shareLinkProposalId: shareLink?.proposalId || null,
      evaluationItemId: shareLink?.evaluationItemId || null,
      documentComparisonId: shareLink?.documentComparisonId || null,
      resolvedProposalId,
      hasReportPayload: Boolean(reportPayload)
    });

    return Response.json({
      ok: true,
      shareLink: {
        id: shareLink.id,
        proposalId: resolvedProposalId,
        evaluationItemId: shareLink.evaluationItemId || null,
        documentComparisonId: shareLink.documentComparisonId || null,
        recipientEmail: shareLink.recipientEmail,
        expiresAt: shareLink.expiresAt,
        uses: shareLink.uses,
        maxUses: shareLink.maxUses,
        status: shareLink.status
      },
      permissions,
      reportData,
      proposalView,
      responsesView,
      recipientView: {
        role: 'recipient',
        proposal: proposalView,
        responses: responsesView
      },
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to load shared report',
      correlationId
    }, { status: 500 });
  }
});
