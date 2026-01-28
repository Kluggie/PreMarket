import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `validate_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const { token } = await req.json();
    
    if (!token) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }

    // Hash the provided token
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Find share link by token hash
    const shareLinks = await base44.asServiceRole.entities.ShareLink.filter({ token_hash: tokenHash });
    const shareLink = shareLinks[0];

    if (!shareLink) {
      return Response.json({
        ok: false,
        errorCode: 'INVALID_TOKEN',
        message: 'Invalid or expired link',
        correlationId
      }, { status: 404 });
    }

    // Check expiration
    if (new Date(shareLink.expires_at) < new Date()) {
      return Response.json({
        ok: false,
        errorCode: 'LINK_EXPIRED',
        message: 'This link has expired',
        correlationId
      }, { status: 403 });
    }

    // Check max uses
    if (shareLink.uses >= shareLink.max_uses) {
      return Response.json({
        ok: false,
        errorCode: 'MAX_USES_EXCEEDED',
        message: 'This link has been used too many times',
        correlationId
      }, { status: 403 });
    }

    // Increment use count
    await base44.asServiceRole.entities.ShareLink.update(shareLink.id, {
      uses: shareLink.uses + 1,
      last_used_at: new Date().toISOString()
    });

    // Load evaluation item
    const evalItems = await base44.asServiceRole.entities.EvaluationItem.filter({ 
      id: shareLink.evaluation_item_id 
    });
    const evalItem = evalItems[0];

    if (!evalItem) {
      return Response.json({
        ok: false,
        errorCode: 'EVAL_NOT_FOUND',
        message: 'Evaluation not found',
        correlationId
      }, { status: 404 });
    }

    // Load the latest evaluation run
    const runs = await base44.asServiceRole.entities.EvaluationRun.filter({ 
      evaluation_item_id: evalItem.id 
    }, '-created_date', 1);
    const latestRun = runs[0];

    // Load the linked proposal or document comparison
    let linkedData = null;
    if (evalItem.linked_proposal_id) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: evalItem.linked_proposal_id });
      linkedData = proposals[0];
    } else if (evalItem.linked_document_comparison_id) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ 
        id: evalItem.linked_document_comparison_id 
      });
      linkedData = comparisons[0];
    }

    console.log(`[ValidateShareLink] Validated for ${shareLink.recipient_email.split('@')[0]}@***, uses: ${shareLink.uses + 1}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      shareLink: {
        id: shareLink.id,
        recipient_email: shareLink.recipient_email,
        recipient_role: shareLink.recipient_role,
        uses: shareLink.uses + 1,
        max_uses: shareLink.max_uses
      },
      evaluationItem: evalItem,
      latestRun,
      linkedData,
      correlationId
    });

  } catch (error) {
    console.error('[ValidateShareLink] Error:', error.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: error.message,
      correlationId
    }, { status: 500 });
  }
});