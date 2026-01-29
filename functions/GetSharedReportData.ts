import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
    
    if (shareLink.documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ 
        id: shareLink.documentComparisonId 
      });
      
      if (comparisons[0]) {
        reportData = {
          type: 'document_comparison',
          id: shareLink.documentComparisonId,
          title: comparisons[0].title,
          status: comparisons[0].status,
          party_a_label: comparisons[0].party_a_label,
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
        // Load latest evaluation report
        const reports = await base44.asServiceRole.entities.EvaluationReportShared.filter({ 
          proposal_id: shareLink.proposalId 
        }, '-created_date', 1);
        
        reportData = {
          type: 'proposal',
          id: shareLink.proposalId,
          title: proposals[0].title,
          template_name: proposals[0].template_name,
          status: proposals[0].status,
          party_a_email: proposals[0].party_a_email,
          party_b_email: proposals[0].party_b_email,
          created_date: proposals[0].created_date,
          sent_at: proposals[0].sent_at,
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
          title: items[0].title,
          status: items[0].status,
          party_a_email: items[0].party_a_email,
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
        recipientEmail: shareLink.recipientEmail,
        expiresAt: shareLink.expiresAt,
        uses: shareLink.uses,
        maxUses: shareLink.maxUses,
        status: shareLink.status
      },
      permissions,
      reportData,
      correlationId
    });

  } catch (error) {
    console.error(`[${correlationId}] GetSharedReportData error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: error.message || 'Failed to load shared report',
      correlationId
    }, { status: 500 });
  }
});