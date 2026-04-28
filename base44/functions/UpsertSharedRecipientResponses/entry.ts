import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value);
  return raw ? raw.toLowerCase() : null;
}

Deno.serve(async (req) => {
  const correlationId = `upsert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    
    if (!user) {
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId
      }, { status: 401 });
    }
    
    const body = await req.json().catch(() => ({}));
    const token = asString(body?.token);
    const responses = Array.isArray(body?.responses) ? body.responses : [];
    
    if (!token) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }
    
    // Validate token and get source proposal
    const shareValidation = await base44.functions.invoke('ResolveSharedReport', {
      token,
      consumeView: false
    });
    
    if (!shareValidation?.data?.ok) {
      return Response.json({
        ok: false,
        errorCode: shareValidation?.data?.code || 'INVALID_TOKEN',
        message: shareValidation?.data?.message || 'Invalid or expired token',
        correlationId
      }, { status: shareValidation?.status || 400 });
    }
    
    const shareData = shareValidation.data;
    const sourceProposalId = asString(shareData?.sourceProposalId || shareData?.proposalId);
    
    if (!sourceProposalId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL',
        message: 'No proposal linked to this share link',
        correlationId
      }, { status: 404 });
    }
    
    // Check permissions
    if (!shareData?.permissions?.canEditRecipientSide && !shareData?.permissions?.canEdit) {
      return Response.json({
        ok: false,
        errorCode: 'EDIT_NOT_ALLOWED',
        message: 'Editing is not allowed for this link',
        correlationId
      }, { status: 403 });
    }
    
    // For document comparison, create/update special Party B fields
    const isDocumentComparison = shareData?.reportData?.type === 'document_comparison';
    
    if (isDocumentComparison) {
      // For document comparison, store Party B notes/responses in a special way
      const partyBNotes = responses.find((r: any) => r.questionId === 'party_b_notes')?.value || '';
      
      // Store as a custom ProposalResponse record
      const existingResponses = await base44.asServiceRole.entities.ProposalResponse.filter({
        proposal_id: sourceProposalId,
        question_id: 'party_b_notes',
        entered_by_party: 'b'
      }, '-created_date', 1);
      
      if (existingResponses.length > 0) {
        await base44.asServiceRole.entities.ProposalResponse.update(existingResponses[0].id, {
          value: partyBNotes,
          updated_date: new Date().toISOString()
        });
      } else {
        await base44.asServiceRole.entities.ProposalResponse.create({
          proposal_id: sourceProposalId,
          question_id: 'party_b_notes',
          entered_by_party: 'b',
          author_party: 'b',
          subject_party: 'b',
          value_type: 'text',
          value: partyBNotes,
          visibility: 'full'
        });
      }
      
      return Response.json({
        ok: true,
        message: 'Party B responses saved',
        updatedCount: 1,
        correlationId
      });
    }
    
    // Standard template-based responses
    let updatedCount = 0;
    
    for (const response of responses) {
      const questionId = asString(response?.questionId);
      if (!questionId) continue;
      
      const valueType = String(response?.valueType || 'text').toLowerCase();
      const value = response?.value ?? null;
      const rangeMin = response?.rangeMin ?? null;
      const rangeMax = response?.rangeMax ?? null;
      const visibility = String(response?.visibility || 'full').toLowerCase();
      
      // Find existing response
      const existingResponses = await base44.asServiceRole.entities.ProposalResponse.filter({
        proposal_id: sourceProposalId,
        question_id: questionId,
        entered_by_party: 'b'
      }, '-created_date', 1);
      
      const payload = {
        proposal_id: sourceProposalId,
        question_id: questionId,
        entered_by_party: 'b',
        author_party: 'b',
        subject_party: 'b',
        value_type: valueType,
        value,
        range_min: rangeMin,
        range_max: rangeMax,
        visibility,
        updated_date: new Date().toISOString()
      };
      
      if (existingResponses.length > 0) {
        await base44.asServiceRole.entities.ProposalResponse.update(existingResponses[0].id, payload);
      } else {
        await base44.asServiceRole.entities.ProposalResponse.create(payload);
      }
      
      updatedCount++;
    }
    
    return Response.json({
      ok: true,
      message: `${updatedCount} Party B response(s) saved`,
      updatedCount,
      correlationId
    });
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] UpsertSharedRecipientResponses error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to save responses',
      correlationId
    }, { status: 500 });
  }
});