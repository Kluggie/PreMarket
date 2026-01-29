import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `get_report_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    // NO AUTH REQUIRED - token is the auth
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

    console.log(`[${correlationId}] Validating token: ${token.substring(0, 8)}...`);

    // Look up share link directly (don't call another function)
    const shareLinks = await base44.asServiceRole.entities.ShareLink.filter({ 
      token: token 
    });
    
    if (!shareLinks || shareLinks.length === 0) {
      console.log(`[${correlationId}] Token not found`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_TOKEN',
        message: 'Invalid or expired link',
        correlationId
      }, { status: 403 });
    }

    const shareLink = shareLinks[0];
    
    // Check expiration
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      console.log(`[${correlationId}] Token expired`);
      return Response.json({
        ok: false,
        errorCode: 'TOKEN_EXPIRED',
        message: 'This link has expired',
        correlationId
      }, { status: 403 });
    }

    // Check max uses
    if (shareLink.max_uses && shareLink.uses >= shareLink.max_uses) {
      console.log(`[${correlationId}] Max uses exceeded`);
      return Response.json({
        ok: false,
        errorCode: 'MAX_USES_EXCEEDED',
        message: 'This link has reached its maximum number of uses',
        correlationId
      }, { status: 403 });
    }

    // Check status
    if (shareLink.status === 'revoked') {
      console.log(`[${correlationId}] Token revoked`);
      return Response.json({
        ok: false,
        errorCode: 'TOKEN_REVOKED',
        message: 'This link has been revoked',
        correlationId
      }, { status: 403 });
    }

    // Increment uses
    try {
      await base44.asServiceRole.entities.ShareLink.update(shareLink.id, {
        uses: (shareLink.uses || 0) + 1,
        last_used_at: new Date().toISOString()
      });
    } catch (err) {
      console.warn(`[${correlationId}] Failed to increment uses:`, err);
    }

    console.log(`[${correlationId}] Token valid, loading report data`);

    // Load report data based on type
    let reportData = null;
    
    if (shareLink.document_comparison_id) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ 
        id: shareLink.document_comparison_id 
      });
      
      if (comparisons[0]) {
        reportData = {
          type: 'document_comparison',
          id: shareLink.document_comparison_id,
          title: comparisons[0].title,
          status: comparisons[0].status,
          party_a_label: comparisons[0].party_a_label,
          party_b_label: comparisons[0].party_b_label,
          created_date: comparisons[0].created_date,
          generated_at: comparisons[0].generated_at,
          report: comparisons[0].evaluation_report_json
        };
      }
    } else if (shareLink.proposal_id) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ 
        id: shareLink.proposal_id 
      });
      
      if (proposals[0]) {
        // Load latest evaluation report
        const reports = await base44.asServiceRole.entities.EvaluationReportShared.filter({ 
          proposal_id: shareLink.proposal_id 
        }, '-created_date', 1);
        
        reportData = {
          type: 'proposal',
          id: shareLink.proposal_id,
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
    } else if (shareLink.evaluation_item_id) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ 
        id: shareLink.evaluation_item_id 
      });
      
      if (items[0]) {
        // Load latest evaluation run
        const runs = await base44.asServiceRole.entities.EvaluationRun.filter({
          evaluation_item_id: shareLink.evaluation_item_id,
          status: 'completed'
        }, '-created_date', 1);

        reportData = {
          type: items[0].type || 'evaluation',
          id: shareLink.evaluation_item_id,
          title: items[0].title,
          status: items[0].status,
          party_a_email: items[0].party_a_email,
          party_b_email: items[0].party_b_email,
          created_date: items[0].created_date,
          report: runs[0]?.public_report_json
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

    console.log(`[${correlationId}] Report loaded successfully`);

    return Response.json({
      ok: true,
      shareLink: {
        id: shareLink.id,
        recipientEmail: shareLink.recipient_email,
        expiresAt: shareLink.expires_at,
        uses: (shareLink.uses || 0) + 1,
        maxUses: shareLink.max_uses,
        status: shareLink.status
      },
      permissions: {
        canView: true,
        canReevaluate: false,
        canSendBack: false
      },
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