import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `emailconfig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.log(`[${correlationId}] Unauthorized access attempt`);
      return Response.json({ 
        ok: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Unauthorized',
        correlationId
      }, { status: 401 });
    }

    // Admin-only check
    if (user.role !== 'admin') {
      console.log(`[${correlationId}] Non-admin user attempted access: ${user.email}`);
      return Response.json({
        ok: false,
        errorCode: 'FORBIDDEN',
        error: 'Admin access required',
        correlationId
      }, { status: 403 });
    }

    // Check email configuration
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL');
    const fromName = Deno.env.get('RESEND_FROM_NAME');
    const replyTo = Deno.env.get('RESEND_REPLY_TO');

    const fromDomain = fromEmail ? fromEmail.split('@')[1] : null;
    const replyToDomain = replyTo ? replyTo.split('@')[1] : null;
    const baseUrl = Deno.env.get('APP_BASE_URL') || new URL(req.url).origin;

    console.log(`[${correlationId}] Email config check - hasKey: ${!!resendApiKey}, fromDomain: ${fromDomain}`);

    return Response.json({
      ok: true,
      hasResendKey: !!resendApiKey,
      fromEmail: fromEmail || null,
      fromName: fromName || null,
      fromDomain: fromDomain || null,
      replyTo: replyTo || null,
      replyToDomain: replyToDomain || null,
      baseUrl: baseUrl,
      environment: Deno.env.get('DENO_DEPLOYMENT_ID') ? 'production' : 'development',
      isValidConfig: !!resendApiKey && fromDomain === 'mail.getpremarket.com',
      correlationId
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