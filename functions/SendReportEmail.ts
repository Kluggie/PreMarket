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

    // Get email configuration
    const fromEmailAddress = Deno.env.get('RESEND_FROM_EMAIL');
    const fromName = Deno.env.get('RESEND_FROM_NAME') || 'PreMarket';
    const replyTo = Deno.env.get('RESEND_REPLY_TO');

    if (!fromEmailAddress) {
      console.error(`[${correlationId}] RESEND_FROM_EMAIL not configured`);
      return Response.json({
        ok: false,
        errorCode: 'EMAIL_CONFIG_MISSING',
        message: 'Email sender not configured. Please add RESEND_FROM_EMAIL secret in app settings.',
        correlationId
      }, { status: 500 });
    }

    const fromDomain = fromEmailAddress.split('@')[1];
    
    // Validate verified domain
    if (fromDomain !== 'mail.getpremarket.com') {
      console.error(`[${correlationId}] Invalid domain: ${fromDomain}`);
      return Response.json({
        ok: false,
        errorCode: 'EMAIL_CONFIG_INVALID',
        message: 'RESEND_FROM_EMAIL must be @mail.getpremarket.com',
        correlationId
      }, { status: 500 });
    }

    const fromEmail = `${fromName} <${fromEmailAddress}>`;
    console.log(`[${correlationId}] Sending from: ${fromDomain}`);

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

    // Build share URL - use provided URL or construct from token
    const baseUrl = Deno.env.get('APP_BASE_URL') || new URL(req.url).origin;
    const sharePageUrl = shareUrl || `${baseUrl}/shared-report?token=${shareLinkResult.data.token}`;

    // Generate PDF attachment
    let pdfAttachment = null;
    try {
      const pdfResult = await base44.functions.invoke('DownloadReportPDF', {
        proposalId,
        evaluationItemId,
        documentComparisonId
      });
      if (pdfResult.data.ok) {
        pdfAttachment = {
          filename: pdfResult.data.filename,
          content: pdfResult.data.pdfBase64
        };
      }
    } catch (pdfError) {
      console.warn(`[${correlationId}] PDF generation failed:`, pdfError.message);
    }

    const emailBody = `
Hello,

${user.full_name || user.email} has shared a report with you: "${itemTitle}"

View the report here:
${sharePageUrl}

This link will expire in 14 days and can be accessed up to 25 times.

---
${fromName}
${baseUrl}
    `.trim();

    const emailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <p>Hello,</p>
  <p>${user.full_name || user.email} has shared a report with you: <strong>"${itemTitle}"</strong></p>
  <div style="margin: 30px 0;">
    <a href="${sharePageUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Open Report</a>
  </div>
  <p style="color: #64748b; font-size: 14px;">This link will expire in 14 days and can be accessed up to 25 times.</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
  <p style="color: #64748b; font-size: 12px;">${fromName}<br>${baseUrl}</p>
</div>
    `.trim();

    // Send email using Resend
    let emailResponse;
    try {
      const emailPayload = {
        from: fromEmail,
        to: email,
        subject: `${user.full_name || user.email} shared: ${itemTitle}`,
        text: emailBody,
        html: emailHtml
      };

      // Add reply_to if configured
      if (replyTo) {
        emailPayload.reply_to = replyTo;
      }

      // Attach PDF if available
      if (pdfAttachment) {
        emailPayload.attachments = [{
          filename: pdfAttachment.filename,
          content: pdfAttachment.content
        }];
      }

      emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailPayload)
      });

      if (!emailResponse.ok) {
        const errorData = await emailResponse.json().catch(() => ({}));
        console.error(`[${correlationId}] Resend API error ${emailResponse.status}:`, errorData);
        console.error(`[${correlationId}] From domain: ${fromDomain}, To domain: ${emailDomain}`);
        
        let errorMessage = 'Email delivery failed';
        if (errorData.message) {
          errorMessage = `Resend: ${errorData.message}`;
        } else {
          errorMessage = `Resend HTTP ${emailResponse.status}`;
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