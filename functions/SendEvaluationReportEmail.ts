import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    // Create access token
    const tokenResult = await base44.functions.invoke('CreateEvaluationAccessToken', {
      evaluationItemId,
      email: toEmail,
      role
    });

    if (!tokenResult.data.ok) {
      return Response.json({
        ok: false,
        error: 'Failed to create access token',
        details: tokenResult.data.error,
        correlationId
      }, { status: 500 });
    }

    const token = tokenResult.data.token;
    const baseUrl = Deno.env.get('APP_BASE_URL') || new URL(req.url).origin;
    const reportUrl = `${baseUrl}/shared-report?token=${token}`;

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
    console.error('[SendEvaluationReportEmail] Error:', error.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      error: error.message,
      correlationId
    }, { status: 500 });
  }
});