import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { SHARE_REPORT_PATH, validateShareUrl } from './_utils/shareUrl.ts';

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

    if (parsed.pathname !== SHARE_REPORT_PATH || !token) {
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
        message: `Share URL must use ${SHARE_REPORT_PATH} and include token`
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
      console.log(`[${correlationId}] Unauthorized access attempt`);
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId
      }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      proposalId,
      evaluationItemId,
      documentComparisonId,
      recipientEmail,
      toEmail,
      message
    } = body;
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

    const canonicalShare = assertCanonicalShareUrl(shareLinkResult.data.shareUrl, correlationId);
    if (!canonicalShare.ok) {
      return Response.json({
        ok: false,
        errorCode: canonicalShare.errorCode,
        message: canonicalShare.message,
        correlationId
      }, { status: 500 });
    }

    const shareUrl = canonicalShare.shareUrl;

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

    const emailBody = `
Hello,

${user.full_name || user.email} has shared a report with you: "${itemTitle}"

${optionalMessage ? `Message:\n${optionalMessage}\n` : ''}

View the report here:
${shareUrl}

This link will expire in 14 days and can be accessed up to 25 times.

---
${fromName}
https://getpremarket.com
    `.trim();

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

    // Send email using Resend
    let emailResponse;
    try {
      const emailPayload: any = {
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
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] SendReportEmail unexpected error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to send report email',
      correlationId
    }, { status: 500 });
  }
});
