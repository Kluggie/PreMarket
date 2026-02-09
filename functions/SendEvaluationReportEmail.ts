import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareUrl } from './_utils/shareUrl.ts';

const CANONICAL_SHARED_PATH = '/SharedReport';

function enforceCanonicalShareUrl(rawShareUrl: string, correlationId: string) {
  let shareUrl = String(rawShareUrl || '').trim();

  if (shareUrl.includes('/shared-report')) {
    console.warn(`[${correlationId}] Lowercase share path detected; correcting before send`);
    shareUrl = shareUrl.replace(/\/shared-report(?=\?|$)/g, CANONICAL_SHARED_PATH);
  }

  try {
    validateShareUrl(shareUrl);
    const parsed = new URL(shareUrl);

    if (parsed.pathname !== CANONICAL_SHARED_PATH) {
      console.warn(
        `[${correlationId}] Non-canonical share path "${parsed.pathname}" detected; forcing ${CANONICAL_SHARED_PATH}`
      );
      parsed.pathname = CANONICAL_SHARED_PATH;
      shareUrl = parsed.toString();
    }

    console.log(JSON.stringify({ level: 'info', correlationId, shareUrlPath: parsed.pathname }));
    return shareUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[${correlationId}] Share URL validation failed; sending best-effort canonical URL`, errorMessage);
    return shareUrl;
  }
}

Deno.serve(async (req) => {
  const correlationId = `email_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false, 
        error: 'Unauthorized',
        correlationId 
      }, { status: 401 });
    }

    const { evaluationItemId, toEmail, role } = await req.json();
    
    if (!evaluationItemId || !toEmail || !role) {
      return Response.json({
        ok: false,
        error: 'Missing required fields: evaluationItemId, toEmail, role',
        correlationId
      }, { status: 400 });
    }

    // Load evaluation item
    const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evaluationItemId });
    const item = items[0];
    
    if (!item) {
      return Response.json({
        ok: false,
        error: 'Evaluation item not found',
        correlationId
      }, { status: 404 });
    }

    // Create share link via canonical flow
    const shareLinkResult = await base44.functions.invoke('CreateShareLink', {
      evaluationItemId,
      recipientEmail: toEmail
    });

    if (!shareLinkResult.data?.ok) {
      return Response.json({
        ok: false,
        error: shareLinkResult.data?.message || 'Failed to create share link',
        errorCode: shareLinkResult.data?.errorCode || 'SHARE_LINK_FAILED',
        correlationId
      }, { status: 500 });
    }

    const shareUrlFromCreate = shareLinkResult.data.shareUrl;
    const shareToken =
      shareLinkResult.data.token ||
      (() => {
        try {
          return shareUrlFromCreate ? new URL(shareUrlFromCreate).searchParams.get('token') : null;
        } catch {
          return null;
        }
      })();

    if (!shareToken) {
      return Response.json({
        ok: false,
        error: 'Share link token missing',
        errorCode: 'SHARE_LINK_INVALID',
        correlationId
      }, { status: 500 });
    }

    if (!shareUrlFromCreate || typeof shareUrlFromCreate !== 'string') {
      return Response.json({
        ok: false,
        error: 'Share link URL missing',
        errorCode: 'SHARE_LINK_INVALID',
        correlationId
      }, { status: 500 });
    }

    const reportUrl = enforceCanonicalShareUrl(shareUrlFromCreate, correlationId);

    if (!reportUrl) {
      return Response.json({
        ok: false,
        errorCode: 'BAD_SHARE_LINK_DOMAIN',
        error: 'Share URL is invalid',
        correlationId
      }, { status: 500 });
    }

    // Determine sender name
    const senderName = user.full_name || user.email || 'A PreMarket user';
    const itemTypeLabel = item.type === 'proposal' ? 'proposal' 
                        : item.type === 'document_comparison' ? 'document comparison'
                        : item.type === 'profile_matching' ? 'profile match'
                        : 'evaluation';

    // Send email
    await base44.integrations.Core.SendEmail({
      from_name: 'PreMarket',
      to: toEmail,
      subject: `${senderName} sent you a ${itemTypeLabel}: ${item.title}`,
      body: `Hi there,

${senderName} has sent you a ${itemTypeLabel} on PreMarket: "${item.title}"

Open your report and respond:
${reportUrl}

This secure link expires in 14 days.

---
PreMarket: Privacy-preserving pre-qualification platform
This is an information exchange only. PreMarket is not a broker, advisor, or transaction handler.
`
    });

    console.log(`[SendEvaluationReportEmail] Sent email to ${toEmail}, type: ${item.type}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      message: 'Email sent successfully',
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[SendEvaluationReportEmail] Error:', err.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      error: err.message,
      correlationId
    }, { status: 500 });
  }
});
