import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { getPublicBaseUrl, validateShareUrl } from './_utils/shareUrl.ts';

const SHARE_PATH = '/SharedReport';

Deno.serve(async (req) => {
  const correlationId = `sharelink_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      console.log(`[${correlationId}] Unauthorized access attempt`);
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId
      }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { proposalId, evaluationItemId, documentComparisonId, recipientEmail } = body;
    
    if (!recipientEmail || !recipientEmail.includes('@')) {
      console.log(`[${correlationId}] Invalid email provided`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_EMAIL',
        message: 'Valid recipient email is required',
        correlationId
      }, { status: 400 });
    }

    // Validate that at least one ID is provided
    if (!proposalId && !evaluationItemId && !documentComparisonId) {
      console.log(`[${correlationId}] Missing ID parameter`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_INPUT',
        message: 'proposalId, evaluationItemId, or documentComparisonId is required',
        correlationId
      }, { status: 400 });
    }

    // Validate that the item exists
    if (proposalId) {
      const proposals = await base44.entities.Proposal.filter({ id: proposalId });
      if (proposals.length === 0) {
        console.log(`[${correlationId}] Proposal not found: ${proposalId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Proposal not found',
          correlationId
        }, { status: 404 });
      }
    }

    if (evaluationItemId) {
      const items = await base44.entities.EvaluationItem.filter({ id: evaluationItemId });
      if (items.length === 0) {
        console.log(`[${correlationId}] Evaluation item not found: ${evaluationItemId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Evaluation item not found',
          correlationId
        }, { status: 404 });
      }
    }

    if (documentComparisonId) {
      const comparisons = await base44.entities.DocumentComparison.filter({ id: documentComparisonId });
      if (comparisons.length === 0) {
        console.log(`[${correlationId}] Document comparison not found: ${documentComparisonId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
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

    console.log(`[${correlationId}] Creating share link for recipient domain: ${recipientEmail.split('@')[1]}`);

    // Create ShareLink
    const shareLink = await base44.asServiceRole.entities.ShareLink.create({
      proposal_id: proposalId || null,
      evaluation_item_id: evaluationItemId || null,
      document_comparison_id: documentComparisonId || null,
      recipient_email: recipientEmail,
      token: token,
      token_hash: token,
      expires_at: expiresAt.toISOString(),
      max_uses: 25,
      uses: 0,
      created_by_user_id: user.id,
      status: 'active'
    });

    // Build share URL from canonical share path (enforces APP_BASE_URL only)
    let shareUrl;
    let baseUrl;
    try {
      baseUrl = getPublicBaseUrl();
      shareUrl = `${baseUrl}${SHARE_PATH}?token=${encodeURIComponent(token)}`;
      validateShareUrl(shareUrl); // Hard guardrail

      // Runtime safeguard: keep legacy lowercase URLs from propagating.
      if (shareUrl.includes('/shared-report')) {
        shareUrl = shareUrl.replace(/\/shared-report(?=\?|$)/g, SHARE_PATH);
      }
    } catch (urlError) {
      console.error(`[${correlationId}] URL construction failed:`, urlError.message);
      return Response.json({
        ok: false,
        errorCode: urlError.message.includes('APP_BASE_URL') ? 'APP_BASE_URL_MISSING' : 'BAD_SHARE_LINK_DOMAIN',
        message: urlError.message,
        correlationId
      }, { status: 500 });
    }
    
    // Store the base URL used for this share link
    await base44.asServiceRole.entities.ShareLink.update(shareLink.id, {
      base_url_used: baseUrl
    });

    console.log(`[${correlationId}] Share link created successfully: ${shareLink.id}`);

    return Response.json({
      ok: true,
      shareUrl,
      token,
      shareLinkId: shareLink.id,
      expiresAt: expiresAt.toISOString(),
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] CreateShareLink error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to create share link',
      correlationId
    }, { status: 500 });
  }
});
