import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `share_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false, 
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId 
      }, { status: 401 });
    }

    const { evaluationItemId, proposalId, documentComparisonId, recipientEmail, recipientRole } = await req.json();
    
    if (!evaluationItemId || !recipientEmail || !recipientRole) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_FIELDS',
        message: 'Missing required fields: evaluationItemId, recipientEmail, recipientRole',
        correlationId
      }, { status: 400 });
    }

    // Validate evaluation item exists
    const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evaluationItemId });
    if (!items[0]) {
      return Response.json({
        ok: false,
        errorCode: 'EVAL_NOT_FOUND',
        message: 'Evaluation item not found',
        correlationId
      }, { status: 404 });
    }

    // Generate random token
    const token = crypto.randomUUID() + '-' + Math.random().toString(36).substring(2, 15);
    
    // Hash the token for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Set expiration to 14 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    // Create share link
    const shareLink = await base44.asServiceRole.entities.ShareLink.create({
      evaluation_item_id: evaluationItemId,
      proposal_id: proposalId || null,
      document_comparison_id: documentComparisonId || null,
      recipient_email: recipientEmail,
      recipient_role: recipientRole,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      max_uses: 25,
      uses: 0,
      created_by_user_id: user.id
    });

    console.log(`[CreateShareLink] Created share link for ${recipientEmail.split('@')[0]}@***, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      shareLinkId: shareLink.id,
      token,
      correlationId
    });

  } catch (error) {
    console.error('[CreateShareLink] Error:', error.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: error.message,
      correlationId
    }, { status: 500 });
  }
});