import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `sendemail_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false, 
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId 
      }, { status: 401 });
    }

    const { evaluationItemId, proposalId, documentComparisonId, recipientEmail } = await req.json();
    
    if (!recipientEmail) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_EMAIL',
        message: 'Recipient email is required',
        correlationId
      }, { status: 400 });
    }

    // Determine which entity to work with
    let evalItemId = evaluationItemId;
    let evalItem = null;

    // If evaluationItemId not provided, create one
    if (!evalItemId) {
      if (!proposalId && !documentComparisonId) {
        return Response.json({
          ok: false,
          errorCode: 'MISSING_REFERENCE',
          message: 'Either evaluationItemId, proposalId, or documentComparisonId is required',
          correlationId
        }, { status: 400 });
      }

      // Load the source entity
      let title = 'Untitled';
      let type = 'other';
      
      if (documentComparisonId) {
        const comps = await base44.asServiceRole.entities.DocumentComparison.filter({ id: documentComparisonId });
        if (!comps[0]) {
          return Response.json({
            ok: false,
            errorCode: 'NOT_FOUND',
            message: 'Document comparison not found',
            correlationId
          }, { status: 404 });
        }
        title = comps[0].title || 'Document Comparison';
        type = 'document_comparison';
      } else if (proposalId) {
        const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: proposalId });
        if (!proposals[0]) {
          return Response.json({
            ok: false,
            errorCode: 'NOT_FOUND',
            message: 'Proposal not found',
            correlationId
          }, { status: 404 });
        }
        title = proposals[0].title || 'Proposal';
        type = 'proposal';
      }

      // Create or find EvaluationItem
      const existingItems = await base44.asServiceRole.entities.EvaluationItem.filter({
        ...(proposalId ? { linked_proposal_id: proposalId } : {}),
        ...(documentComparisonId ? { linked_document_comparison_id: documentComparisonId } : {})
      });

      if (existingItems[0]) {
        evalItem = existingItems[0];
        evalItemId = evalItem.id;
      } else {
        evalItem = await base44.asServiceRole.entities.EvaluationItem.create({
          type,
          title,
          created_by_user_id: user.id,
          party_a_user_id: user.id,
          party_a_email: user.email,
          party_b_email: recipientEmail,
          status: 'completed',
          linked_proposal_id: proposalId || null,
          linked_document_comparison_id: documentComparisonId || null,
          revision_number: 0
        });
        evalItemId = evalItem.id;
      }
    } else {
      // Load existing evaluation item
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evalItemId });
      evalItem = items[0];
      if (!evalItem) {
        return Response.json({
          ok: false,
          errorCode: 'EVAL_NOT_FOUND',
          message: 'Evaluation item not found',
          correlationId
        }, { status: 404 });
      }
    }

    // Check if report exists
    const runs = await base44.asServiceRole.entities.EvaluationRun.filter({ 
      evaluation_item_id: evalItemId 
    }, '-created_date', 1);
    
    if (!runs[0] || !runs[0].public_report_json) {
      return Response.json({
        ok: false,
        errorCode: 'NO_REPORT',
        message: 'No evaluation report available yet. Please run evaluation first.',
        correlationId
      }, { status: 400 });
    }

    // Determine recipient role
    const recipientRole = evalItem.party_b_email === recipientEmail ? 'party_b' : 'party_a';

    // Create share link
    const shareLinkResult = await base44.functions.invoke('CreateShareLink', {
      evaluationItemId: evalItemId,
      proposalId: evalItem.linked_proposal_id,
      documentComparisonId: evalItem.linked_document_comparison_id,
      recipientEmail,
      recipientRole
    });

    if (!shareLinkResult.data.ok) {
      return Response.json({
        ok: false,
        errorCode: 'SHARELINK_FAILED',
        message: shareLinkResult.data.message || 'Failed to create share link',
        correlationId
      }, { status: 500 });
    }

    const { shareLinkId, token } = shareLinkResult.data;
    
    // Build magic link
    const origin = req.headers.get('origin') || 'https://premarket.base44.app';
    const magicLink = `${origin}/shared/${shareLinkId}?token=${token}`;

    // Determine email content based on type
    const senderName = user.full_name || user.email || 'A PreMarket user';
    const itemTypeLabel = evalItem.type === 'proposal' ? 'proposal' 
                        : evalItem.type === 'document_comparison' ? 'document comparison'
                        : evalItem.type === 'profile_matching' ? 'profile match'
                        : 'evaluation';

    const emailBody = `Hi there,

${senderName} has shared a ${itemTypeLabel} with you on PreMarket: "${evalItem.title}"

📊 View Report & Respond:
${magicLink}

You can:
• Review the AI-generated report
• Edit your information
• Re-run the evaluation
• Send your response back

This secure link expires in 14 days.

---
PreMarket: Privacy-preserving pre-qualification platform
This is an information exchange only. PreMarket is not a broker, advisor, or transaction handler.
`;

    // Send email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return Response.json({
        ok: false,
        errorCode: 'NO_API_KEY',
        message: 'Email service not configured',
        correlationId
      }, { status: 500 });
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'PreMarket <noreply@premarket.com>',
        to: recipientEmail,
        subject: `${senderName} sent you a ${itemTypeLabel}: ${evalItem.title}`,
        text: emailBody
      })
    });

    const emailData = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error('[SendReportEmail] Resend error:', emailData, 'correlationId:', correlationId);
      return Response.json({
        ok: false,
        errorCode: 'EMAIL_SEND_FAILED',
        message: `Email provider error: ${emailData.message || 'Unknown error'}`,
        detailsSafe: `Status: ${emailResponse.status}`,
        correlationId
      }, { status: 500 });
    }

    console.log(`[SendReportEmail] Sent to ${recipientEmail.split('@')[0]}@${recipientEmail.split('@')[1]}, status: ${emailResponse.status}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      message: 'Report sent successfully',
      emailId: emailData.id,
      correlationId
    });

  } catch (error) {
    console.error('[SendReportEmail] Error:', error.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: error.message,
      correlationId
    }, { status: 500 });
  }
});