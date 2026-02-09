import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { buildSharedReportUrl, getPublicBaseUrl, SHARE_REPORT_PATH, validateShareUrl } from './_utils/shareUrl.ts';

function logInfo(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', ...payload }));
}

function extractProposalId(source: any): string | null {
  if (!source || typeof source !== 'object') return null;
  const data = source.data && typeof source.data === 'object' ? source.data : {};
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
    let resolvedProposalId = proposalId || null;
    
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

    // Validate and resolve proposal linkage from the provided identifiers.
    if (proposalId) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: proposalId }, '-created_date', 1);
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
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evaluationItemId }, '-created_date', 1);
      if (items.length === 0) {
        console.log(`[${correlationId}] Evaluation item not found: ${evaluationItemId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Evaluation item not found',
          correlationId
        }, { status: 404 });
      }
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(items[0]);
      }
    }

    if (documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ id: documentComparisonId }, '-created_date', 1);
      if (comparisons.length === 0) {
        console.log(`[${correlationId}] Document comparison not found: ${documentComparisonId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Document comparison not found',
          correlationId
        }, { status: 404 });
      }
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(comparisons[0]);
      }
    }

    if (!resolvedProposalId) {
      logInfo({
        correlationId,
        event: 'share_link_resolution_failed',
        proposalId: proposalId || null,
        evaluationItemId: evaluationItemId || null,
        documentComparisonId: documentComparisonId || null,
        resolvedProposalId: null
      });
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL_ID',
        message: 'Share link must be linked to a proposal',
        correlationId
      }, { status: 400 });
    }

    const resolvedProposals = await base44.asServiceRole.entities.Proposal.filter({ id: resolvedProposalId }, '-created_date', 1);
    if (resolvedProposals.length === 0) {
      return Response.json({
        ok: false,
        errorCode: 'NOT_FOUND',
        message: 'Resolved proposal not found',
        correlationId
      }, { status: 404 });
    }

    // Generate random token
    const token = crypto.randomUUID() + '_' + Math.random().toString(36).substring(2, 15);
    
    // Set expiration (14 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    console.log(`[${correlationId}] Creating share link for recipient domain: ${recipientEmail.split('@')[1]}`);
    logInfo({
      correlationId,
      event: 'share_link_resolved',
      proposalId: proposalId || null,
      evaluationItemId: evaluationItemId || null,
      documentComparisonId: documentComparisonId || null,
      resolvedProposalId
    });

    // Create ShareLink
    const shareLink = await base44.asServiceRole.entities.ShareLink.create({
      proposal_id: resolvedProposalId,
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
      shareUrl = buildSharedReportUrl(token);
      validateShareUrl(shareUrl); // Hard guardrail

      const parsedUrl = new URL(shareUrl);
      if (parsedUrl.pathname !== SHARE_REPORT_PATH) {
        console.error(`[${correlationId}] NON_CANONICAL_SHARE_PATH`, {
          pathname: parsedUrl.pathname,
          shareUrl
        });
        throw new Error(`NON_CANONICAL_SHARE_PATH:${parsedUrl.pathname}`);
      }
    } catch (urlError) {
      const urlErrorMessage = urlError instanceof Error ? urlError.message : String(urlError);
      console.error(`[${correlationId}] URL construction failed:`, urlErrorMessage);
      return Response.json({
        ok: false,
        errorCode:
          urlErrorMessage.includes('NON_CANONICAL_SHARE_PATH')
            ? 'NON_CANONICAL_SHARE_PATH'
            : (urlErrorMessage.includes('APP_BASE_URL') ? 'APP_BASE_URL_MISSING' : 'BAD_SHARE_LINK_DOMAIN'),
        message: urlErrorMessage,
        correlationId
      }, { status: 500 });
    }
    
    // Store the base URL used for this share link
    await base44.asServiceRole.entities.ShareLink.update(shareLink.id, {
      base_url_used: `${baseUrl}${SHARE_REPORT_PATH}`
    });

    logInfo({
      correlationId,
      event: 'share_link_created',
      shareLinkId: shareLink.id,
      proposalId: resolvedProposalId,
      evaluationItemId: evaluationItemId || null,
      documentComparisonId: documentComparisonId || null
    });

    return Response.json({
      ok: true,
      shareUrl,
      token,
      proposalId: resolvedProposalId,
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
