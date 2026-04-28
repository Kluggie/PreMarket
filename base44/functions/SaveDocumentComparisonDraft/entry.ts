import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

type PartySide = 'a' | 'b' | 'unknown';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const normalized = asString(value)?.toLowerCase() || null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function toArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeHighlightLevel(level: unknown): 'confidential' | null {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

function normalizeHighlights(spans: unknown): any[] {
  return toArray(spans)
    .map((span: any) => {
      const start = Number(span?.start);
      const end = Number(span?.end);
      const level = normalizeHighlightLevel(span?.level);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !level) return null;
      return { start: Math.floor(start), end: Math.floor(end), level };
    })
    .filter((span): span is { start: number; end: number; level: 'confidential' } => Boolean(span))
    .sort((a, b) => a.start - b.start);
}

function parseStep(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 1) {
    return Math.floor(numeric);
  }
  return fallback;
}

function resolvePartySide(proposal: any, user: any): PartySide {
  if (!proposal || !user) return 'unknown';

  const userId = asString(user?.id);
  const userEmail = normalizeEmail(user?.email);

  const partyAUserId = asString(proposal?.party_a_user_id || proposal?.created_by_user_id);
  const partyAEmail = normalizeEmail(proposal?.party_a_email);
  const partyBUserId = asString(proposal?.party_b_user_id);
  const partyBEmail = normalizeEmail(proposal?.party_b_email);

  if (
    (userId && partyAUserId && userId === partyAUserId) ||
    (userEmail && partyAEmail && userEmail === partyAEmail)
  ) {
    return 'a';
  }

  if (
    (userId && partyBUserId && userId === partyBUserId) ||
    (userEmail && partyBEmail && userEmail === partyBEmail)
  ) {
    return 'b';
  }

  return 'unknown';
}

Deno.serve(async (req) => {
  const correlationId = `save_comparison_draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'You must be signed in to save a draft',
        correlationId
      }, { status: 401 });
    }

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const comparisonId = asString(body?.comparisonId || body?.comparison_id);
    const proposalId = asString(body?.proposalId || body?.proposal_id);
    const stepToSave = parseStep(body?.stepToSave ?? body?.draftStep, 1);

    const hasDocASpanUpdate =
      Object.prototype.hasOwnProperty.call(body, 'docASpans') ||
      Object.prototype.hasOwnProperty.call(body, 'doc_a_spans_json');
    const hasDocBSpanUpdate =
      Object.prototype.hasOwnProperty.call(body, 'docBSpans') ||
      Object.prototype.hasOwnProperty.call(body, 'doc_b_spans_json');

    let linkedProposal: any = null;
    if (proposalId) {
      const proposalRows = await base44.asServiceRole.entities.Proposal
        .filter({ id: proposalId }, '-created_date', 1)
        .catch(() => []);
      linkedProposal = proposalRows?.[0] || null;
    }

    let existingComparison: any = null;
    if (comparisonId) {
      const comparisonRows = await base44.asServiceRole.entities.DocumentComparison
        .filter({ id: comparisonId }, '-created_date', 1)
        .catch(() => []);
      existingComparison = comparisonRows?.[0] || null;
      if (!existingComparison) {
        return Response.json({
          ok: false,
          code: 'COMPARISON_NOT_FOUND',
          message: 'Draft comparison not found',
          correlationId
        }, { status: 404 });
      }
    }

    if (!linkedProposal && comparisonId) {
      const byComparisonRows = await base44.asServiceRole.entities.Proposal
        .filter({ document_comparison_id: comparisonId }, '-created_date', 1)
        .catch(() => []);
      linkedProposal = byComparisonRows?.[0] || null;
    }

    let side: PartySide = linkedProposal ? resolvePartySide(linkedProposal, user) : 'a';
    if (linkedProposal && side === 'unknown') {
      return Response.json({
        ok: false,
        code: 'FORBIDDEN_SIDE',
        message: 'You are not allowed to update highlights for this proposal',
        correlationId
      }, { status: 403 });
    }

    if (side === 'a' && hasDocBSpanUpdate) {
      return Response.json({
        ok: false,
        code: 'FORBIDDEN_SIDE',
        message: 'Party A cannot modify Document B confidentiality spans',
        correlationId
      }, { status: 403 });
    }

    if (side === 'b' && hasDocASpanUpdate) {
      return Response.json({
        ok: false,
        code: 'FORBIDDEN_SIDE',
        message: 'Party B cannot modify Document A confidentiality spans',
        correlationId
      }, { status: 403 });
    }

    const nowIso = new Date().toISOString();

    const title = asString(body?.title) || asString(existingComparison?.title) || 'Untitled';
    const partyALabel = asString(body?.partyALabel) || asString(body?.party_a_label) || asString(existingComparison?.party_a_label) || 'Document A';
    const partyBLabel = asString(body?.partyBLabel) || asString(body?.party_b_label) || asString(existingComparison?.party_b_label) || 'Document B';
    const docASource = asString(body?.docASource) || asString(body?.doc_a_source) || asString(existingComparison?.doc_a_source) || 'typed';
    const docBSource = asString(body?.docBSource) || asString(body?.doc_b_source) || asString(existingComparison?.doc_b_source) || 'typed';
    const docAText = typeof body?.docAText === 'string'
      ? body.docAText
      : (typeof body?.doc_a_plaintext === 'string' ? body.doc_a_plaintext : String(existingComparison?.doc_a_plaintext || ''));
    const docBText = typeof body?.docBText === 'string'
      ? body.docBText
      : (typeof body?.doc_b_plaintext === 'string' ? body.doc_b_plaintext : String(existingComparison?.doc_b_plaintext || ''));
    const docAFiles = toArray(body?.docAFiles ?? body?.doc_a_files ?? existingComparison?.doc_a_files);
    const docBFiles = toArray(body?.docBFiles ?? body?.doc_b_files ?? existingComparison?.doc_b_files);

    const comparisonPayload: Record<string, unknown> = {
      title,
      created_by_user_id: asString(existingComparison?.created_by_user_id) || asString(user?.id),
      party_a_label: partyALabel,
      party_b_label: partyBLabel,
      doc_a_plaintext: docAText,
      doc_b_plaintext: docBText,
      doc_a_source: docASource,
      doc_b_source: docBSource,
      doc_a_files: docAFiles,
      doc_b_files: docBFiles,
      status: 'draft',
      draft_step: stepToSave,
      draft_updated_at: nowIso
    };

    if (hasDocASpanUpdate) {
      comparisonPayload.doc_a_spans_json = normalizeHighlights(body?.docASpans ?? body?.doc_a_spans_json);
    } else if (!existingComparison) {
      comparisonPayload.doc_a_spans_json = [];
    }

    if (hasDocBSpanUpdate) {
      comparisonPayload.doc_b_spans_json = normalizeHighlights(body?.docBSpans ?? body?.doc_b_spans_json);
    } else if (!existingComparison) {
      comparisonPayload.doc_b_spans_json = [];
    }

    let savedComparisonId = comparisonId;
    if (savedComparisonId) {
      await base44.asServiceRole.entities.DocumentComparison.update(savedComparisonId, comparisonPayload);
    } else {
      const createdComparison = await base44.asServiceRole.entities.DocumentComparison.create(comparisonPayload);
      savedComparisonId = asString(createdComparison?.id);
    }

    if (!savedComparisonId) {
      return Response.json({
        ok: false,
        code: 'SAVE_FAILED',
        message: 'Failed to save comparison draft',
        correlationId
      }, { status: 500 });
    }

    if (!linkedProposal) {
      if (side === 'unknown') side = 'a';
      const createProposalPayload: Record<string, unknown> = {
        title,
        proposal_type: 'document_comparison',
        document_comparison_id: savedComparisonId,
        status: 'draft',
        draft_step: stepToSave,
        draft_updated_at: nowIso
      };
      if (side === 'b') {
        createProposalPayload.party_b_user_id = asString(user?.id);
        createProposalPayload.party_b_email = asString(user?.email);
      } else {
        createProposalPayload.party_a_user_id = asString(user?.id);
        createProposalPayload.party_a_email = asString(user?.email);
      }
      linkedProposal = await base44.asServiceRole.entities.Proposal.create(createProposalPayload);
    } else {
      await base44.asServiceRole.entities.Proposal.update(linkedProposal.id, {
        title,
        proposal_type: 'document_comparison',
        document_comparison_id: savedComparisonId,
        status: 'draft',
        draft_step: stepToSave,
        draft_updated_at: nowIso
      });
    }

    return Response.json({
      ok: true,
      comparisonId: savedComparisonId,
      proposalId: asString(linkedProposal?.id),
      editableHighlightSide: side === 'b' ? 'b' : 'a',
      draftStep: stepToSave,
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: err.message || 'Failed to save document comparison draft',
      correlationId
    }, { status: 500 });
  }
});
