import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `validate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    // Guest-safe: NO auth required
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

    console.log(`[${correlationId}] Validating share link token`);

    // Find share link by token (guest-safe query)
    const shareLinks = await base44.asServiceRole.entities.ShareLink.filter({ token });
    
    if (shareLinks.length === 0) {
      console.log(`[${correlationId}] Token not found`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_TOKEN',
        message: 'Share link not found',
        correlationId
      }, { status: 404 });
    }

    const shareLink = shareLinks[0];

    // Check expiration
    if (new Date(shareLink.expires_at) < new Date()) {
      console.log(`[${correlationId}] Token expired`);
      return Response.json({
        ok: false,
        errorCode: 'TOKEN_EXPIRED',
        message: 'This share link has expired',
        correlationId
      }, { status: 403 });
    }

    // Check max uses
    if (shareLink.uses >= shareLink.max_uses) {
      console.log(`[${correlationId}] Max uses reached`);
      return Response.json({
        ok: false,
        errorCode: 'MAX_USES_REACHED',
        message: 'This share link has reached its maximum number of uses',
        correlationId
      }, { status: 403 });
    }

    // Check status
    if (shareLink.status !== 'active') {
      console.log(`[${correlationId}] Token not active`);
      return Response.json({
        ok: false,
        errorCode: 'TOKEN_INACTIVE',
        message: 'This share link is no longer active',
        correlationId
      }, { status: 403 });
    }

    // Update usage count
    await base44.asServiceRole.entities.ShareLink.update(shareLink.id, {
      uses: (shareLink.uses || 0) + 1,
      last_used_at: new Date().toISOString()
    });

    console.log(`[${correlationId}] Token validated successfully`);

    return Response.json({
      ok: true,
      correlationId,
      shareLink: {
        id: shareLink.id,
        proposalId: shareLink.proposal_id,
        evaluationItemId: shareLink.evaluation_item_id,
        documentComparisonId: shareLink.document_comparison_id,
        recipientEmail: shareLink.recipient_email,
        expiresAt: shareLink.expires_at,
        uses: shareLink.uses + 1,
        maxUses: shareLink.max_uses
      },
      permissions: {
        canView: true,
        canEditRecipientSide: true,
        canReevaluate: true,
        canSendBack: true
      }
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] Unexpected error:`, err.message);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL',
      error: err.message,
      correlationId
    }, { status: 500 });
  }
});