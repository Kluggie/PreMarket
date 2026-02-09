import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareUrl } from './_utils/shareUrl.ts';

const CANONICAL_SHARED_PATH = '/SharedReport';

function assertCanonicalShareUrl(rawShareUrl: unknown, correlationId: string) {
  const shareUrl = String(rawShareUrl || '').trim();
  if (!shareUrl) {
    console.warn(JSON.stringify({
      level: 'warn',
      correlationId,
      errorCode: 'SHARE_LINK_INVALID',
      message: 'Share link URL missing'
    }));
    return {
      ok: false as const,
      errorCode: 'SHARE_LINK_INVALID',
      message: 'Share link URL missing'
    };
  }

  try {
    validateShareUrl(shareUrl);
    const parsed = new URL(shareUrl);
    const token = parsed.searchParams.get('token');

    if (parsed.pathname !== CANONICAL_SHARED_PATH || !token) {
      console.warn(JSON.stringify({
        level: 'warn',
        correlationId,
        errorCode: 'NON_CANONICAL_SHARE_URL',
        shareUrlPath: parsed.pathname,
        hasToken: Boolean(token),
        shareUrl
      }));
      return {
        ok: false as const,
        errorCode: 'NON_CANONICAL_SHARE_URL',
        message: 'Share URL must use /SharedReport and include token'
      };
    }

    console.log(JSON.stringify({ level: 'info', correlationId, shareUrlPath: parsed.pathname }));
    return {
      ok: true as const,
      shareUrl,
      token
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(JSON.stringify({
      level: 'warn',
      correlationId,
      errorCode: 'SHARE_LINK_INVALID',
      message: 'Share URL validation failed',
      error: errorMessage
    }));
    return {
      ok: false as const,
      errorCode: 'SHARE_LINK_INVALID',
      message: 'Share URL is invalid'
    };
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

    const canonicalShare = assertCanonicalShareUrl(shareLinkResult.data.shareUrl, correlationId);
    if (!canonicalShare.ok) {
      return Response.json({
        ok: false,
        errorCode: canonicalShare.errorCode,
        error: canonicalShare.message,
        correlationId
      }, { status: 500 });
    }

    const reportUrl = canonicalShare.shareUrl;

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
