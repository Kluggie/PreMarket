import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { buildSharedReportUrl, validateShareUrl } from './_utils/shareUrl.js';

Deno.serve(async (req) => {
  const correlationId = `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth check
    let user;
    try {
      user = await base44.auth.me();
    } catch (authError) {
      await logEmailSend(base44, {
        correlationId,
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
    }

    // Parse input
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      await logEmailSend(base44, {
        correlationId,
        ok: false,
        errorCode: 'INVALID_INPUT',
        message: 'Invalid JSON input'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'INVALID_INPUT',
        message: 'Invalid JSON input'
      });
    }

    const { proposalId, evaluationItemId, documentComparisonId, recipientEmail } = body;
    
    // Validate email
    if (!recipientEmail || !recipientEmail.includes('@')) {
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        ok: false,
        errorCode: 'INVALID_EMAIL',
        message: 'Valid recipient email is required'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'INVALID_EMAIL',
        message: 'Valid recipient email is required'
      });
    }

    const recipientDomain = recipientEmail.split('@')[1];
    console.log(`[${correlationId}] Sending to domain: ${recipientDomain}`);

    // Validate at least one ID
    if (!proposalId && !evaluationItemId && !documentComparisonId) {
      await logEmailSend(base44, {
        correlationId,
        recipientDomain,
        ok: false,
        errorCode: 'INVALID_INPUT',
        message: 'proposalId, evaluationItemId, or documentComparisonId is required'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'INVALID_INPUT',
        message: 'proposalId, evaluationItemId, or documentComparisonId is required'
      });
    }

    // Check provider configuration
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error(`[${correlationId}] RESEND_API_KEY not configured`);
      
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: 'MISSING_EMAIL_PROVIDER_KEY',
        message: 'Missing RESEND_API_KEY in Secrets',
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'MISSING_EMAIL_PROVIDER_KEY',
        message: 'Email provider not configured. Please add RESEND_API_KEY secret in app settings.'
      });
    }

    // Get email configuration
    const fromEmailAddress = Deno.env.get('RESEND_FROM_EMAIL');
    const fromName = Deno.env.get('RESEND_FROM_NAME') || 'PreMarket';
    const replyTo = Deno.env.get('RESEND_REPLY_TO');

    if (!fromEmailAddress) {
      console.error(`[${correlationId}] RESEND_FROM_EMAIL not configured`);
      
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: 'EMAIL_CONFIG_MISSING',
        message: 'Missing RESEND_FROM_EMAIL',
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'EMAIL_CONFIG_MISSING',
        message: 'Email sender not configured. Please add RESEND_FROM_EMAIL secret in app settings.'
      });
    }

    const fromDomain = fromEmailAddress.split('@')[1];
    
    // Validate verified domain
    if (fromDomain !== 'mail.getpremarket.com') {
      console.error(`[${correlationId}] Invalid domain: ${fromDomain}`);
      
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: 'EMAIL_CONFIG_INVALID',
        message: `RESEND_FROM_EMAIL must be @mail.getpremarket.com, got @${fromDomain}`,
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'EMAIL_CONFIG_INVALID',
        message: 'RESEND_FROM_EMAIL must be @mail.getpremarket.com'
      });
    }

    const fromEmail = `${fromName} <${fromEmailAddress}>`;
    console.log(`[${correlationId}] Sending from: ${fromDomain}`);
    console.log(`[${correlationId}] Sending to: ${recipientDomain}`);

    // Create share link
    let shareLinkResult;
    try {
      shareLinkResult = await base44.functions.invoke('CreateShareLink', {
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientEmail
      });
    } catch (shareLinkError) {
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: 'SHARE_LINK_FAILED',
        message: `Share link creation failed: ${shareLinkError.message}`,
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'SHARE_LINK_FAILED',
        message: `Failed to create share link: ${shareLinkError.message}`
      });
    }

    if (!shareLinkResult.data.ok) {
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: shareLinkResult.data.errorCode || 'SHARE_LINK_FAILED',
        message: shareLinkResult.data.message || 'Share link creation failed',
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: shareLinkResult.data.errorCode || 'SHARE_LINK_FAILED',
        message: shareLinkResult.data.message || 'Failed to create share link'
      });
    }

    // Recompute share URL using token (overrides any stored URL that may be outdated)
    const shareToken = shareLinkResult.data.token || shareLinkResult.data.shareUrl?.split('token=')[1];
    if (!shareToken) {
      console.error(`[${correlationId}] No token in share link result`);
      
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: 'SHARE_LINK_INVALID',
        message: 'Share link token missing',
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'SHARE_LINK_INVALID',
        message: 'Share link token missing'
      });
    }

    let shareUrl;
    try {
      shareUrl = buildSharedReportUrl(shareToken);
      validateShareUrl(shareUrl); // Hard guardrail
    } catch (urlError) {
      console.error(`[${correlationId}] Share URL construction failed:`, urlError.message);
      
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: urlError.message.includes('APP_BASE_URL') ? 'APP_BASE_URL_MISSING' : 'BAD_SHARE_LINK_DOMAIN',
        message: urlError.message,
        provider: 'resend'
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: urlError.message.includes('APP_BASE_URL') ? 'APP_BASE_URL_MISSING' : 'BAD_SHARE_LINK_DOMAIN',
        message: urlError.message
      });
    }

    // Get item title
    let itemTitle = 'Evaluation Report';
    try {
      if (proposalId) {
        const proposals = await base44.entities.Proposal.filter({ id: proposalId });
        if (proposals[0]) {
          itemTitle = proposals[0].title || proposals[0].template_name || 'Proposal';
        }
      } else if (documentComparisonId) {
        const comparisons = await base44.entities.DocumentComparison.filter({ id: documentComparisonId });
        if (comparisons[0]) {
          itemTitle = comparisons[0].title || 'Document Comparison';
        }
      } else if (evaluationItemId) {
        const items = await base44.entities.EvaluationItem.filter({ id: evaluationItemId });
        if (items[0]) {
          itemTitle = items[0].title || 'Evaluation';
        }
      }
    } catch (titleError) {
      console.log(`[${correlationId}] Could not fetch title: ${titleError.message}`);
    }

    console.log(`[${correlationId}] Share URL: ${shareUrl}`);

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

    // Build email
    const emailBody = `Hello,

${user.full_name || user.email} has shared a report with you: "${itemTitle}"

View the report here:
${shareUrl}

This link will expire in 14 days and can be accessed up to 25 times.

---
${fromName}
https://getpremarket.com`;

    const emailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <p>Hello,</p>
  <p>${user.full_name || user.email} has shared a report with you: <strong>"${itemTitle}"</strong></p>
  <div style="margin: 30px 0;">
    <a href="${shareUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Open Report</a>
  </div>
  <p style="color: #64748b; font-size: 14px;">This link will expire in 14 days and can be accessed up to 25 times.</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
  <p style="color: #64748b; font-size: 12px;">${fromName}<br>https://getpremarket.com</p>
</div>
    `.trim();

    // Send email via Resend
    let emailResponse;
    let providerStatus = 0;
    
    try {
      const emailPayload = {
        from: fromEmail,
        to: recipientEmail,
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

      providerStatus = emailResponse.status;

      if (!emailResponse.ok) {
        const errorData = await emailResponse.json().catch(() => ({}));
        console.error(`[${correlationId}] Resend error ${providerStatus}:`, errorData);
        console.error(`[${correlationId}] From domain: ${fromDomain}, To domain: ${recipientDomain}`);
        
        let errorMessage = 'Email delivery failed';
        
        if (errorData.message) {
          errorMessage = `Resend: ${errorData.message}`;
        } else {
          errorMessage = `Resend HTTP ${providerStatus}`;
        }

        await logEmailSend(base44, {
          correlationId,
          proposalId,
          evaluationItemId,
          documentComparisonId,
          recipientDomain,
          ok: false,
          errorCode: 'EMAIL_PROVIDER_ERROR',
          message: errorMessage,
          provider: 'resend',
          providerStatus
        });
        
        return Response.json({
          ok: false,
          correlationId,
          errorCode: 'EMAIL_PROVIDER_ERROR',
          message: errorMessage,
          debug: { providerStatus, fromDomain, toDomain: recipientDomain }
        });
      }

      const responseData = await emailResponse.json().catch(() => ({}));
      console.log(`[${correlationId}] Email sent successfully. Resend ID: ${responseData.id || 'unknown'}`);

      // Log success
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: true,
        message: 'Email sent successfully',
        provider: 'resend',
        providerStatus: 200
      });

      return Response.json({
        ok: true,
        correlationId,
        message: `Report sent to ${recipientEmail}`,
        shareUrl
      });

    } catch (emailError) {
      console.error(`[${correlationId}] Email send exception:`, emailError.message);
      
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: 'EMAIL_PROVIDER_ERROR',
        message: `Email send failed: ${emailError.message}`,
        provider: 'resend',
        providerStatus
      });
      
      return Response.json({
        ok: false,
        correlationId,
        errorCode: 'EMAIL_PROVIDER_ERROR',
        message: `Failed to send email: ${emailError.message}`,
        debug: { name: emailError.name, providerStatus }
      });
    }

  } catch (error) {
    // Top-level catch - should never reach here but ensures no raw 500
    console.error(`[${correlationId}] Unhandled exception:`, error);
    
    try {
      const base44 = createClientFromRequest(req);
      await logEmailSend(base44, {
        correlationId,
        ok: false,
        errorCode: 'UNHANDLED_EXCEPTION',
        message: error.message || 'Unknown error occurred'
      });
    } catch (logError) {
      console.error(`[${correlationId}] Could not log error:`, logError);
    }
    
    return Response.json({
      ok: false,
      correlationId,
      errorCode: 'UNHANDLED_EXCEPTION',
      message: error.message || 'An unexpected error occurred',
      debug: {
        name: error.name,
        status: error.status
      }
    });
  }
});

async function logEmailSend(base44, data) {
  try {
    await base44.asServiceRole.entities.EmailSendLog.create({
      correlation_id: data.correlationId,
      proposal_id: data.proposalId || null,
      evaluation_item_id: data.evaluationItemId || null,
      document_comparison_id: data.documentComparisonId || null,
      recipient_domain: data.recipientDomain || null,
      ok: data.ok,
      error_code: data.errorCode || null,
      message: data.message,
      provider: data.provider || null,
      provider_status: data.providerStatus || null
    });
  } catch (logError) {
    console.error(`Failed to log email send [${data.correlationId}]:`, logError.message);
  }
}