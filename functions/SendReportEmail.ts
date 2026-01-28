import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `sre_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
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

    const { proposalId, evaluationItemId, documentComparisonId, recipientEmail, toEmail } = await req.json();
    const email = recipientEmail || toEmail;
    
    if (!email || !email.includes('@')) {
      return Response.json({
        ok: false,
        message: 'Valid recipient email is required',
        correlationId
      }, { status: 400 });
    }

    // Create share link
    const shareLinkResult = await base44.functions.invoke('CreateShareLink', {
      proposalId,
      evaluationItemId,
      documentComparisonId,
      recipientEmail: email
    });

    if (!shareLinkResult.data.ok) {
      return Response.json({
        ok: false,
        message: shareLinkResult.data.message || 'Failed to create share link',
        correlationId
      }, { status: 500 });
    }

    const { shareUrl } = shareLinkResult.data;

    // Get item details for email
    let itemTitle = 'Evaluation Report';
    let itemType = 'evaluation';

    if (proposalId) {
      const proposals = await base44.entities.Proposal.filter({ id: proposalId });
      if (proposals[0]) {
        itemTitle = proposals[0].title || proposals[0].template_name || 'Proposal';
        itemType = 'proposal';
      }
    } else if (documentComparisonId) {
      const comparisons = await base44.entities.DocumentComparison.filter({ id: documentComparisonId });
      if (comparisons[0]) {
        itemTitle = comparisons[0].title || 'Document Comparison';
        itemType = 'document comparison';
      }
    } else if (evaluationItemId) {
      const items = await base44.entities.EvaluationItem.filter({ id: evaluationItemId });
      if (items[0]) {
        itemTitle = items[0].title || 'Evaluation';
        itemType = items[0].type || 'evaluation';
      }
    }

    // Send email using Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return Response.json({
        ok: false,
        message: 'Email provider not configured (RESEND_API_KEY missing)',
        correlationId
      }, { status: 500 });
    }

    const emailBody = `
Hello,

${user.full_name || user.email} has shared a report with you: "${itemTitle}"

View the report here:
${shareUrl}

This link will expire in 14 days and can be accessed up to 25 times.

Best regards,
The Team
    `.trim();

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'reports@trustexchange.app',
        to: email,
        subject: `${user.full_name || user.email} shared: ${itemTitle}`,
        text: emailBody,
        html: emailBody.replace(/\n/g, '<br>')
      })
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      console.error('Resend error:', errorData);
      return Response.json({
        ok: false,
        message: `Email delivery failed: ${errorData.message || emailResponse.statusText}`,
        correlationId
      }, { status: 500 });
    }

    return Response.json({
      ok: true,
      message: `Report sent to ${email}`,
      shareUrl
    });

  } catch (error) {
    console.error('SendReportEmail error:', error);
    return Response.json({
      ok: false,
      message: error.message || 'Failed to send report email',
      correlationId
    }, { status: 500 });
  }
});