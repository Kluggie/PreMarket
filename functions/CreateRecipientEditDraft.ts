import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

Deno.serve(async (req) => {
  const correlationId = `recipient_edit_draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'You must be signed in to create a recipient draft',
        correlationId
      }, { status: 401 });
    }

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const sourceProposalId = asString(body?.sourceProposalId || body?.proposalId || body?.source_proposal_id);

    if (!sourceProposalId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_SOURCE_PROPOSAL_ID',
        message: 'sourceProposalId is required',
        correlationId
      }, { status: 400 });
    }

    const sourceProposalRows = await base44.asServiceRole.entities.Proposal
      .filter({ id: sourceProposalId }, '-created_date', 1)
      .catch(() => []);
    const sourceProposal = sourceProposalRows?.[0] || null;

    if (!sourceProposal) {
      return Response.json({
        ok: false,
        errorCode: 'SOURCE_PROPOSAL_NOT_FOUND',
        message: 'Source proposal was not found',
        correlationId
      }, { status: 404 });
    }

    const sourceProposalData = asObject(sourceProposal?.data);
    let sourceComparisonId = asString(
      sourceProposal?.document_comparison_id ||
      sourceProposal?.documentComparisonId ||
      sourceProposalData?.document_comparison_id ||
      sourceProposalData?.documentComparisonId
    );
    let sourceComparison: any = null;

    if (sourceComparisonId) {
      const sourceComparisonRows = await base44.asServiceRole.entities.DocumentComparison
        .filter({ id: sourceComparisonId }, '-created_date', 1)
        .catch(() => []);
      sourceComparison = sourceComparisonRows?.[0] || null;
    }

    if (!sourceComparison) {
      const byProposalRows = await base44.asServiceRole.entities.DocumentComparison
        .filter({ proposal_id: sourceProposalId }, '-created_date', 1)
        .catch(() => []);
      sourceComparison = byProposalRows?.[0] || null;
      sourceComparisonId = asString(sourceComparison?.id) || sourceComparisonId;
    }

    if (!sourceComparison) {
      const byDataProposalRows = await base44.asServiceRole.entities.DocumentComparison
        .filter({ 'data.proposal_id': sourceProposalId }, '-created_date', 1)
        .catch(() => []);
      sourceComparison = byDataProposalRows?.[0] || null;
      sourceComparisonId = asString(sourceComparison?.id) || sourceComparisonId;
    }

    if (!sourceComparison) {
      return Response.json({
        ok: false,
        errorCode: 'SOURCE_COMPARISON_NOT_FOUND',
        message: 'Source document comparison was not found',
        correlationId
      }, { status: 404 });
    }

    const sourceComparisonData = asObject(sourceComparison?.data);
    const nowIso = new Date().toISOString();
    const draftComparison = await base44.asServiceRole.entities.DocumentComparison.create({
      title: asString(sourceComparison?.title) || asString(sourceProposal?.title) || 'Untitled Comparison',
      created_by_user_id: user.id,
      party_a_label: asString(sourceComparison?.party_a_label) || asString(sourceComparisonData?.party_a_label) || 'Document A',
      party_b_label: asString(sourceComparison?.party_b_label) || asString(sourceComparisonData?.party_b_label) || 'Document B',
      doc_a_plaintext: sourceComparison?.doc_a_plaintext ?? sourceComparisonData?.doc_a_plaintext ?? '',
      doc_b_plaintext: sourceComparison?.doc_b_plaintext ?? sourceComparisonData?.doc_b_plaintext ?? '',
      doc_a_spans_json: asArray(sourceComparison?.doc_a_spans_json ?? sourceComparisonData?.doc_a_spans_json),
      doc_b_spans_json: asArray(sourceComparison?.doc_b_spans_json ?? sourceComparisonData?.doc_b_spans_json),
      doc_a_source: asString(sourceComparison?.doc_a_source) || asString(sourceComparisonData?.doc_a_source) || 'typed',
      doc_b_source: asString(sourceComparison?.doc_b_source) || asString(sourceComparisonData?.doc_b_source) || 'typed',
      doc_a_files: asArray(sourceComparison?.doc_a_files ?? sourceComparisonData?.doc_a_files),
      doc_b_files: asArray(sourceComparison?.doc_b_files ?? sourceComparisonData?.doc_b_files),
      status: 'draft',
      draft_step: 2,
      draft_updated_at: nowIso
    });

    const draftProposal = await base44.asServiceRole.entities.Proposal.create({
      title: asString(sourceProposal?.title) || asString(sourceComparison?.title) || 'Untitled Comparison',
      proposal_type: 'document_comparison',
      document_comparison_id: draftComparison?.id,
      party_a_user_id: sourceProposal?.party_a_user_id ?? sourceProposalData?.party_a_user_id ?? null,
      party_a_email: sourceProposal?.party_a_email ?? sourceProposalData?.party_a_email ?? null,
      party_b_user_id: user.id,
      party_b_email: asString(user?.email) || sourceProposal?.party_b_email || null,
      status: 'draft',
      draft_step: 2,
      draft_updated_at: nowIso,
      sourceProposalId,
      source_proposal_id: sourceProposalId,
      data: {
        sourceProposalId,
        source_proposal_id: sourceProposalId,
        sourceDocumentComparisonId: sourceComparisonId,
        source_document_comparison_id: sourceComparisonId,
        recipientEditDraft: true,
        recipient_edit_draft: true,
        created_from_shared_report: true
      }
    });

    return Response.json({
      ok: true,
      sourceProposalId,
      sourceDocumentComparisonId: sourceComparisonId,
      newDraftProposalId: asString(draftProposal?.id),
      newDraftComparisonId: asString(draftComparison?.id),
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to create recipient edit draft',
      correlationId
    }, { status: 500 });
  }
});
