import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PARTY_A_KEYS = new Set(['a', 'party_a', 'proposer']);

const normalizeParty = (party: unknown) => String(party || 'a').toLowerCase();

const isPartyAResponse = (response: any) => PARTY_A_KEYS.has(normalizeParty(response?.entered_by_party));

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
    // No auth required - token is the auth
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { token } = body;
    
    if (!token) {
      console.log(`[${correlationId}] Missing token`);
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }

    console.log(`[${correlationId}] Validating token`);

    // Validate token via ValidateShareLink
    const validateResult = await base44.asServiceRole.functions.invoke('ValidateShareLink', { token });
    
    if (!validateResult.data.ok) {
      console.log(`[${correlationId}] Token validation failed:`, validateResult.data.errorCode);
      return Response.json({
        ok: false,
        errorCode: validateResult.data.errorCode || 'INVALID_TOKEN',
        message: validateResult.data.message || 'Invalid or expired token',
        correlationId
      }, { status: 403 });
    }

    const { shareLink, permissions } = validateResult.data;
    console.log(`[${correlationId}] Token valid, loading report data`);

    // Load report data based on type
    let reportData = null;
    let proposalView = null;
    let responsesView: any[] = [];
    
    if (shareLink.documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ 
        id: shareLink.documentComparisonId 
      });
      
      if (comparisons[0]) {
        const comparisonData = comparisons[0]?.data && typeof comparisons[0].data === 'object'
          ? comparisons[0].data
          : {};
        reportData = {
          type: 'document_comparison',
          id: shareLink.documentComparisonId,
          proposal_id: comparisons[0].proposal_id || comparisonData.proposal_id || null,
          proposalId: comparisons[0].proposal_id || comparisonData.proposal_id || null,
          documentComparisonId: shareLink.documentComparisonId,
          title: comparisons[0].title,
          status: comparisons[0].status,
          party_a_label: 'Identity Protected',
          party_b_label: comparisons[0].party_b_label,
          created_date: comparisons[0].created_date,
          generated_at: comparisons[0].generated_at,
          report: comparisons[0].evaluation_report_json
        };
      }
    } else if (shareLink.proposalId) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ 
        id: shareLink.proposalId 
      });
      
      if (proposals[0]) {
        const proposal = proposals[0];

        const proposalResponses = await base44.asServiceRole.entities.ProposalResponse.filter(
          { proposal_id: shareLink.proposalId },
          '-created_date'
        );

        proposalView = buildRecipientProposalView(proposal);
        responsesView = proposalResponses.map(buildRecipientResponseView);

        // Load latest evaluation report
        const reports = await base44.asServiceRole.entities.EvaluationReportShared.filter({ 
          proposal_id: shareLink.proposalId 
        }, '-created_date', 1);
        
        reportData = {
          type: 'proposal',
          id: shareLink.proposalId,
          title: proposal.title,
          template_name: proposal.template_name,
          status: proposal.status,
          party_a_email: 'Identity Protected',
          party_b_email: proposal.party_b_email || null,
          created_date: proposal.created_date,
          sent_at: proposal.sent_at,
          report: reports[0]?.output_report_json
        };
      }
    } else if (shareLink.evaluationItemId) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ 
        id: shareLink.evaluationItemId 
      });
      
      if (items[0]) {
        reportData = {
          type: items[0].type || 'evaluation',
          id: shareLink.evaluationItemId,
          proposal_id: items[0].linked_proposal_id || null,
          proposalId: items[0].linked_proposal_id || null,
          evaluationItemId: shareLink.evaluationItemId,
          title: items[0].title,
          status: items[0].status,
          party_a_email: 'Identity Protected',
          party_b_email: items[0].party_b_email,
          created_date: items[0].created_date
        };
      }
    }

    if (!reportData) {
      console.log(`[${correlationId}] Report data not found`);
      return Response.json({
        ok: false,
        errorCode: 'REPORT_NOT_FOUND',
        message: 'Report not found',
        correlationId
      }, { status: 404 });
    }

    console.log(`[${correlationId}] Report data loaded successfully`);

    return Response.json({
      ok: true,
      shareLink: {
        id: shareLink.id,
        proposalId: shareLink.proposalId || null,
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
    console.error(`[${correlationId}] GetSharedReportData error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to load shared report',
      correlationId
    }, { status: 500 });
  }
});
