import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHighlightLevel(level: unknown): 'confidential' | null {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

function normalizeHighlights(spans: unknown, textLength: number) {
  if (!Array.isArray(spans)) return [];

  const normalized = spans
    .map((span: any) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeHighlightLevel(span?.level);

      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;

      const start = Math.max(0, Math.min(Math.floor(rawStart), textLength));
      const end = Math.max(0, Math.min(Math.floor(rawEnd), textLength));
      if (end <= start) return null;

      return { start, end, level };
    })
    .filter((span): span is { start: number; end: number; level: 'confidential' } => Boolean(span))
    .sort((a, b) => a.start - b.start);

  const deduped: Array<{ start: number; end: number; level: 'confidential' }> = [];
  for (const span of normalized) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.start !== span.start || prev.end !== span.end || prev.level !== span.level) {
      deduped.push(span);
    }
  }
  return deduped;
}

function proposalBelongsToRecipient(proposal: any, user: any): boolean {
  const userId = asString(user?.id);
  const userEmail = asString(user?.email)?.toLowerCase() || null;
  const proposalPartyBUserId = asString(proposal?.party_b_user_id);
  const proposalPartyBEmail = asString(proposal?.party_b_email)?.toLowerCase() || null;

  if (proposalPartyBUserId && userId) {
    return proposalPartyBUserId === userId;
  }
  if (proposalPartyBEmail && userEmail) {
    return proposalPartyBEmail === userEmail;
  }
  return false;
}

Deno.serve(async (req) => {
  const correlationId = `recipient_highlights_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'You must be signed in to save recipient highlights',
        correlationId
      }, { status: 401 });
    }

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const proposalId = asString(body?.proposalId || body?.proposal_id);
    const docBSpansRaw = body?.docBSpans ?? body?.doc_b_spans_json ?? [];
    const attemptedDocASpansRaw = body?.docASpans ?? body?.doc_a_spans_json;
    const attemptedDocAUpdate = Array.isArray(attemptedDocASpansRaw) && attemptedDocASpansRaw.length > 0;

    if (!proposalId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL_ID',
        message: 'proposalId is required',
        correlationId
      }, { status: 400 });
    }

    const proposalRows = await base44.asServiceRole.entities.Proposal
      .filter({ id: proposalId }, '-created_date', 1)
      .catch(() => []);
    const proposal = proposalRows?.[0] || null;

    if (!proposal) {
      return Response.json({
        ok: false,
        errorCode: 'PROPOSAL_NOT_FOUND',
        message: 'Draft proposal not found',
        correlationId
      }, { status: 404 });
    }

    const proposalData = proposal?.data && typeof proposal.data === 'object' ? proposal.data : {};
    const isRecipientDraft = Boolean(
      proposalData?.recipientEditDraft ||
      proposalData?.recipient_edit_draft ||
      proposal?.sourceProposalId ||
      proposal?.source_proposal_id
    );
    if (!isRecipientDraft) {
      return Response.json({
        ok: false,
        errorCode: 'NOT_RECIPIENT_DRAFT',
        message: 'This draft is not a recipient-edit draft',
        correlationId
      }, { status: 403 });
    }

    if (!proposalBelongsToRecipient(proposal, user)) {
      return Response.json({
        ok: false,
        errorCode: 'FORBIDDEN',
        message: 'You are not allowed to edit this recipient draft',
        correlationId
      }, { status: 403 });
    }

    const comparisonId = asString(proposal?.document_comparison_id || proposalData?.document_comparison_id);
    if (!comparisonId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_COMPARISON_ID',
        message: 'Draft proposal has no linked comparison',
        correlationId
      }, { status: 400 });
    }

    const comparisonRows = await base44.asServiceRole.entities.DocumentComparison
      .filter({ id: comparisonId }, '-created_date', 1)
      .catch(() => []);
    const comparison = comparisonRows?.[0] || null;

    if (!comparison) {
      return Response.json({
        ok: false,
        errorCode: 'COMPARISON_NOT_FOUND',
        message: 'Draft comparison not found',
        correlationId
      }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const docBText = String(comparison?.doc_b_plaintext || '');
    const normalizedDocBSpans = normalizeHighlights(docBSpansRaw, docBText.length);

    await base44.asServiceRole.entities.DocumentComparison.update(comparisonId, {
      doc_b_spans_json: normalizedDocBSpans,
      status: 'draft',
      draft_step: 3,
      draft_updated_at: nowIso
    });

    await base44.asServiceRole.entities.Proposal.update(proposalId, {
      status: 'draft',
      draft_step: 3,
      draft_updated_at: nowIso
    });

    if (attemptedDocAUpdate) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'recipient_doc_a_highlight_update_ignored',
        correlationId,
        proposalId,
        comparisonId,
        userId: asString(user?.id)
      }));
    }

    return Response.json({
      ok: true,
      proposalId,
      comparisonId,
      docBSpans: normalizedDocBSpans,
      docBHighlightCount: normalizedDocBSpans.length,
      ignoredDocAUpdate: attemptedDocAUpdate,
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to save recipient highlights',
      correlationId
    }, { status: 500 });
  }
});
