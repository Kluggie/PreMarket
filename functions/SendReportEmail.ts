import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `email_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
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
    const { proposalId, evaluationItemId, documentComparisonId, recipientEmail, toEmail } = body;
    const email = recipientEmail || toEmail;
    
    // Validation
    if (!proposalId && !evaluationItemId && !documentComparisonId) {
      console.log(`[${correlationId}] Missing ID parameter`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_INPUT',
        message: 'proposalId, evaluationItemId, or documentComparisonId is required',
        correlationId
      }, { status: 400 });
    }

    if (!email || !email.includes('@')) {
      console.log(`[${correlationId}] Invalid email provided`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_EMAIL',
        message: 'Valid recipient email is required',
        correlationId
      }, { status: 400 });
    }

    const emailDomain = email.split('@')[1];
    console.log(`[${correlationId}] Sending to domain: ${emailDomain}`);

    // Validate that item exists
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

    // Check email provider configuration
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error(`[${correlationId}] RESEND_API_KEY not configured`);
      return Response.json({
        ok: false,
        errorCode: 'MISSING_EMAIL_PROVIDER_KEY',
        message: 'Email provider not configured. Please add RESEND_API_KEY secret in app settings.',
        correlationId
      }, { status: 500 });
    }

    // Create share link
    const shareLinkResult = await base44.functions.invoke('CreateShareLink', {
      proposalId,
      evaluationItemId,
      documentComparisonId,
      recipientEmail: email
    });

    if (!shareLinkResult.data.ok) {
      console.error(`[${correlationId}] CreateShareLink failed:`, shareLinkResult.data);
      return Response.json({
        ok: false,
        errorCode: shareLinkResult.data.errorCode || 'SHARE_LINK_FAILED',
        message: shareLinkResult.data.message || 'Failed to create share link',
        correlationId: shareLinkResult.data.correlationId || correlationId
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

    console.log(`[${correlationId}] Preparing email for: ${itemTitle}`);

    const emailBody = `
Hello,

${user.full_name || user.email} has shared a report with you: "${itemTitle}"

View the report here:
${shareUrl}

This link will expire in 14 days and can be accessed up to 25 times.

Best regards,
Trust Exchange Team
    `.trim();

    // Send email using Resend
    let emailResponse;
    try {
      emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Trust Exchange <reports@trustexchange.app>',
          to: email,
          subject: `${user.full_name || user.email} shared: ${itemTitle}`,
          text: emailBody,
          html: emailBody.replace(/\n/g, '<br>')
        })
      });

      if (!emailResponse.ok) {
        const errorData = await emailResponse.json().catch(() => ({}));
        console.error(`[${correlationId}] Resend API error ${emailResponse.status}:`, errorData);
        
        let errorMessage = 'Email delivery failed';
        if (emailResponse.status === 422 && errorData.message) {
          errorMessage = `Email provider error: ${errorData.message}`;
          if (errorData.message.includes('not verified') || errorData.message.includes('domain')) {
            return Response.json({
              ok: false,
              errorCode: 'SENDER_NOT_VERIFIED',
              message: 'Email sender domain not verified in Resend. Please verify your sender domain in Resend settings.',
              correlationId
            }, { status: 500 });
          }
        } else if (errorData.message) {
          errorMessage = `Email provider error: ${errorData.message}`;
        } else {
          errorMessage = `Email provider error: HTTP ${emailResponse.status}`;
        }

        return Response.json({
          ok: false,
          errorCode: 'EMAIL_PROVIDER_ERROR',
          message: errorMessage,
          correlationId
        }, { status: 500 });
      }

      const responseData = await emailResponse.json().catch(() => ({}));
      console.log(`[${correlationId}] Email sent successfully. Resend ID: ${responseData.id || 'unknown'}`);

      return Response.json({
        ok: true,
        message: `Report sent to ${email}`,
        shareUrl,
        correlationId
      });

    } catch (emailError) {
      console.error(`[${correlationId}] Email send exception:`, emailError.message);
      return Response.json({
        ok: false,
        errorCode: 'EMAIL_PROVIDER_ERROR',
        message: `Failed to send email: ${emailError.message}`,
        correlationId
      }, { status: 500 });
    }

  } catch (error) {
    console.error(`[${correlationId}] SendReportEmail unexpected error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: error.message || 'Failed to send report email',
      correlationId
    }, { status: 500 });
  }
});