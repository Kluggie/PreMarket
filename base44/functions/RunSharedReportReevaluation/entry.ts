import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseObjectField(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

Deno.serve(async (req) => {
  const correlationId = `reeval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    
    const body = await req.json().catch(() => ({}));
    const token = asString(body?.token);
    
    if (!token) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }
    
    // Validate token and get share data
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
    const documentComparisonId = asString(shareData?.reportData?.documentComparisonId);
    
    if (!sourceProposalId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL',
        message: 'No proposal linked to this share link',
        correlationId
      }, { status: 404 });
    }
    
    // Check permissions
    if (!shareData?.permissions?.canReevaluate) {
      return Response.json({
        ok: false,
        errorCode: 'REEVALUATION_NOT_ALLOWED',
        message: 'Re-evaluation is not allowed for this link',
        correlationId
      }, { status: 403 });
    }
    
    // Get proposal
    const proposals = await base44.asServiceRole.entities.Proposal.filter(
      { id: sourceProposalId },
      '-created_date',
      1
    );
    const proposal = proposals?.[0];
    
    if (!proposal) {
      return Response.json({
        ok: false,
        errorCode: 'PROPOSAL_NOT_FOUND',
        message: 'Proposal not found',
        correlationId
      }, { status: 404 });
    }
    
    // Call evaluation based on type
    let evaluationResult;
    
    if (documentComparisonId) {
      // Document comparison evaluation
      evaluationResult = await base44.asServiceRole.functions.invoke('EvaluateDocumentComparison', {
        documentComparisonId,
        proposalId: sourceProposalId
      });
    } else {
      // Standard proposal evaluation
      evaluationResult = await base44.asServiceRole.functions.invoke('EvaluateProposal', {
        proposalId: sourceProposalId
      });
    }
    
    if (!evaluationResult?.data?.ok) {
      return Response.json({
        ok: false,
        errorCode: 'EVALUATION_FAILED',
        message: evaluationResult?.data?.message || 'Evaluation failed',
        correlationId
      }, { status: evaluationResult?.status || 500 });
    }
    
    return Response.json({
      ok: true,
      message: 'Re-evaluation completed successfully',
      reevaluation: evaluationResult.data,
      correlationId
    });
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] RunSharedReportReevaluation error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Re-evaluation failed',
      correlationId
    }, { status: 500 });
  }
});