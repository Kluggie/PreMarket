import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `csl_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({
        ok: false,
        message: 'Unauthorized',
        correlationId
      }, { status: 401 });
    }

    const { proposalId, evaluationItemId, documentComparisonId, recipientEmail } = await req.json();
    
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return Response.json({
        ok: false,
        message: 'Valid recipient email is required',
        correlationId
      }, { status: 400 });
    }

    // Validate that at least one ID is provided
    if (!proposalId && !evaluationItemId && !documentComparisonId) {
      return Response.json({
        ok: false,
        message: 'proposalId, evaluationItemId, or documentComparisonId is required',
        correlationId
      }, { status: 400 });
    }

    // Validate that the item exists
    if (proposalId) {
      const proposals = await base44.entities.Proposal.filter({ id: proposalId });
      if (proposals.length === 0) {
        return Response.json({
          ok: false,
          message: 'Proposal not found',
          correlationId
        }, { status: 404 });
      }
    }

    if (evaluationItemId) {
      const items = await base44.entities.EvaluationItem.filter({ id: evaluationItemId });
      if (items.length === 0) {
        return Response.json({
          ok: false,
          message: 'Evaluation item not found',
          correlationId
        }, { status: 404 });
      }
    }

    if (documentComparisonId) {
      const comparisons = await base44.entities.DocumentComparison.filter({ id: documentComparisonId });
      if (comparisons.length === 0) {
        return Response.json({
          ok: false,
          message: 'Document comparison not found',
          correlationId
        }, { status: 404 });
      }
    }

    // Generate random token
    const token = crypto.randomUUID() + '_' + Math.random().toString(36).substring(2, 15);
    
    // Set expiration (14 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    // Create ShareLink
    const shareLink = await base44.asServiceRole.entities.ShareLink.create({
      proposal_id: proposalId || null,
      evaluation_item_id: evaluationItemId || null,
      document_comparison_id: documentComparisonId || null,
      recipient_email: recipientEmail,
      token: token,
      token_hash: token, // For simple implementation, storing token directly
      expires_at: expiresAt.toISOString(),
      max_uses: 25,
      uses: 0,
      created_by_user_id: user.id,
      status: 'active'
    });

    // Build share URL
    const appUrl = Deno.env.get('BASE44_APP_URL') || 'https://app.base44.com';
    const shareUrl = `${appUrl}/shared/${shareLink.id}?token=${token}`;

    return Response.json({
      ok: true,
      shareUrl,
      shareLinkId: shareLink.id,
      expiresAt: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('CreateShareLink error:', error);
    return Response.json({
      ok: false,
      message: error.message || 'Failed to create share link',
      correlationId
    }, { status: 500 });
  }
});