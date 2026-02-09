import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

function parseConsumeView(req: Request, body: any): boolean {
  if (typeof body?.consumeView === 'boolean') {
    return body.consumeView;
  }

  const raw = new URL(req.url).searchParams.get('consumeView');
  if (raw === null) return true;
  return raw !== 'false';
}

function toStatusLabel(statusCode: number): 'ok' | 'not_found' | 'forbidden' | 'expired' | 'invalid' {
  if (statusCode === 404) return 'not_found';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 410) return 'expired';
  if (statusCode >= 400) return 'invalid';
  return 'ok';
}

Deno.serve(async (req) => {
  const correlationId = `validate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const token = body?.token || new URL(req.url).searchParams.get('token');
    const consumeView = parseConsumeView(req, body);

    const result = await validateShareLinkAccess(base44, {
      token,
      consumeView
    });

    if (!result.ok) {
      const payload = {
        ok: false,
        status: toStatusLabel(result.statusCode),
        code: result.code,
        reason: result.reason,
        message: result.message,
        shareLink: result.shareLink || null,
        permissions: result.permissions || null,
        matchedRecipient: result.matchedRecipient,
        currentUserEmail: result.currentUserEmail,
        consumedView: false,
        correlationId
      };
      console.warn(`[${correlationId}] ValidateShareLink denied`, payload);
      return Response.json(payload, { status: result.statusCode });
    }

    const payload = {
      ok: true,
      status: 'ok',
      code: result.code,
      reason: result.reason,
      message: result.message,
      shareLink: {
        id: result.shareLink.id,
        token: result.shareLink.token,
        proposalId: result.shareLink.proposalId,
        evaluationItemId: result.shareLink.evaluationItemId,
        documentComparisonId: result.shareLink.documentComparisonId,
        recipientEmail: result.shareLink.recipientEmail,
        status: result.shareLink.status,
        mode: result.shareLink.mode,
        createdAt: result.shareLink.createdAt,
        expiresAt: result.shareLink.expiresAt,
        uses: result.shareLink.viewCount,
        maxUses: result.shareLink.maxViews,
        viewCount: result.shareLink.viewCount,
        maxViews: result.shareLink.maxViews,
        lastUsedAt: result.shareLink.lastUsedAt
      },
      permissions: result.permissions,
      matchedRecipient: result.matchedRecipient,
      currentUserEmail: result.currentUserEmail,
      consumedView: result.consumedView,
      correlationId
    };

    console.log(`[${correlationId}] ValidateShareLink success`, {
      tokenPrefix: String(token || '').slice(0, 8),
      proposalId: result.shareLink.proposalId,
      viewCount: result.shareLink.viewCount,
      consumedView: result.consumedView
    });

    return Response.json(payload);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] ValidateShareLink unexpected error`, err.message);
    return Response.json({
      ok: false,
      status: 'invalid',
      code: 'INTERNAL_ERROR',
      reason: 'INTERNAL_ERROR',
      message: 'Failed to validate share link',
      correlationId
    }, { status: 500 });
  }
});
