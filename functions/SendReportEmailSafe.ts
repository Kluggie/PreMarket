import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { SHARE_REPORT_PATH, validateShareUrl } from './_utils/shareUrl.ts';

function logInfo(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', ...payload }));
}

function logWarn(payload: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: 'warn', ...payload }));
}

function assertCanonicalShareUrl(rawShareUrl: unknown, correlationId: string) {
  const shareUrl = String(rawShareUrl || '').trim();
  if (!shareUrl) {
    logWarn({ correlationId, errorCode: 'SHARE_LINK_INVALID', message: 'Share link URL missing' });
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

    if (parsed.pathname !== SHARE_REPORT_PATH || !token) {
      logWarn({
        correlationId,
        errorCode: 'NON_CANONICAL_SHARE_URL',
        shareUrlPath: parsed.pathname,
        hasToken: Boolean(token),
        shareUrl
      });
      return {
        ok: false as const,
        errorCode: 'NON_CANONICAL_SHARE_URL',
        message: `Share URL must use ${SHARE_REPORT_PATH} and include token`
      };
    }

    logInfo({ correlationId, shareUrlPath: parsed.pathname });
    return {
      ok: true as const,
      shareUrl,
      token
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarn({
      correlationId,
      errorCode: 'SHARE_LINK_INVALID',
      message: 'Share URL validation failed',
      error: errorMessage
    });
    return {
      ok: false as const,
      errorCode: 'SHARE_LINK_INVALID',
      message: 'Share URL is invalid'
    };
  }
}

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

    const {
      proposalId,
      evaluationItemId,
      documentComparisonId,
      recipientEmail,
      toEmail,
      message
    } = body;
    const resolvedRecipientEmail = recipientEmail || toEmail;
    
    // Validate email
    if (!resolvedRecipientEmail || !resolvedRecipientEmail.includes('@')) {
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

    const recipientDomain = resolvedRecipientEmail.split('@')[1];
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
        recipientEmail: resolvedRecipientEmail
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

    const canonicalShare = assertCanonicalShareUrl(shareLinkResult.data.shareUrl, correlationId);
    if (!canonicalShare.ok) {
      await logEmailSend(base44, {
        correlationId,
        proposalId,
        evaluationItemId,
        documentComparisonId,
        recipientDomain,
        ok: false,
        errorCode: canonicalShare.errorCode,
        message: canonicalShare.message,
        provider: 'resend'
      });

      return Response.json({
        ok: false,
        correlationId,
        errorCode: canonicalShare.errorCode,
        message: canonicalShare.message
      });
    }

    const shareUrl = canonicalShare.shareUrl;
    const shareToken = canonicalShare.token;

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

    const optionalMessage = typeof message === 'string' ? message.trim() : '';
    const escapedMessage = optionalMessage
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Build email
    const emailBody = `Hello,

${user.full_name || user.email} has shared a report with you: "${itemTitle}"

${optionalMessage ? `Message:\n${optionalMessage}\n` : ''}

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
  ${optionalMessage ? `<div style="margin: 16px 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc;"><p style="margin: 0 0 8px; font-size: 13px; color: #475569;">Message</p><p style="margin: 0; white-space: pre-wrap;">${escapedMessage}</p></div>` : ''}
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
      const emailPayload: any = {
        from: fromEmail,
        to: resolvedRecipientEmail,
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

      const debugShareUrlPath = new URL(shareUrl).pathname;
      logInfo({ correlationId, debugShareUrlPath });

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
        message: `Report sent to ${resolvedRecipientEmail}`,
        shareUrl,
        token: shareToken,
        debugShareUrlSent: shareUrl,
        debugShareUrlPath: new URL(shareUrl).pathname
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
    const err = error instanceof Error ? error : new Error(String(error));
    // Top-level catch - should never reach here but ensures no raw 500
    console.error(`[${correlationId}] Unhandled exception:`, error);
    
    try {
      const base44 = createClientFromRequest(req);
      await logEmailSend(base44, {
        correlationId,
        ok: false,
        errorCode: 'UNHANDLED_EXCEPTION',
        message: err.message || 'Unknown error occurred'
      });
    } catch (logError) {
      console.error(`[${correlationId}] Could not log error:`, logError);
    }
    
    return Response.json({
      ok: false,
      correlationId,
      errorCode: 'UNHANDLED_EXCEPTION',
      message: err.message || 'An unexpected error occurred',
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
