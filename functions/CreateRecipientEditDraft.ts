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

function normalizeEmail(value: unknown): string | null {
  const normalized = asString(value)?.toLowerCase() || null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseVersionFromTitle(title: string | null, baseTitle: string): number | null {
  if (!title) return null;
  const matcher = new RegExp(`^${escapeRegExp(baseTitle)}\\s*\\((\\d+)\\)$`);
  const match = title.match(matcher);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function isRecipientEditDraft(proposal: any): boolean {
  const data = asObject(proposal?.data);
  return Boolean(
    proposal?.is_recipient_edit_draft === true ||
    proposal?.recipient_edit_draft === true ||
    data?.recipient_edit_draft === true ||
    data?.recipientEditDraft === true
  );
}

function isOwnedByUser(proposal: any, user: any): boolean {
  const userId = asString(user?.id);
  const proposalOwnerId = asString(proposal?.party_a_user_id || proposal?.created_by_user_id);
  if (userId && proposalOwnerId) {
    return userId === proposalOwnerId;
  }

  const userEmail = normalizeEmail(user?.email);
  const proposalOwnerEmail = normalizeEmail(proposal?.party_a_email || proposal?.created_by_email);
  return Boolean(userEmail && proposalOwnerEmail && userEmail === proposalOwnerEmail);
}

function extractRecipientEditVersion(proposal: any, baseTitle: string): number | null {
  const data = asObject(proposal?.data);
  const direct = Number(
    proposal?.recipient_edit_version ??
    proposal?.recipientEditVersion ??
    data?.recipient_edit_version ??
    data?.recipientEditVersion ??
    0
  );
  if (Number.isFinite(direct) && direct > 0) {
    return Math.floor(direct);
  }

  return parseVersionFromTitle(asString(proposal?.title), baseTitle);
}

function dedupeById(records: any[]): any[] {
  const byId = new Map<string, any>();
  records.forEach((record, index) => {
    const id = asString(record?.id) || `row_${index}`;
    if (!byId.has(id)) {
      byId.set(id, record);
    }
  });
  return Array.from(byId.values());
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

    const baseTitle = asString(sourceProposal?.title) || asString(sourceComparison?.title) || 'Untitled';
    const sourcePartyAUserId = asString(sourceProposal?.party_a_user_id || sourceProposalData?.party_a_user_id);
    const sourcePartyAEmail = normalizeEmail(sourceProposal?.party_a_email || sourceProposalData?.party_a_email);

    const fetchExistingRecipientDrafts = async () => {
      const existingBuckets = await Promise.all([
        base44.asServiceRole.entities.Proposal.filter({ source_proposal_id: sourceProposalId }, '-created_date', 200).catch(() => []),
        base44.asServiceRole.entities.Proposal.filter({ sourceProposalId: sourceProposalId }, '-created_date', 200).catch(() => []),
        base44.asServiceRole.entities.Proposal.filter({ 'data.source_proposal_id': sourceProposalId }, '-created_date', 200).catch(() => [])
      ]);

      return dedupeById(existingBuckets.flat())
        .filter((proposal) => isRecipientEditDraft(proposal))
        .filter((proposal) => isOwnedByUser(proposal, user));
    };

    const computeNextVersion = async () => {
      let attempts = 0;
      let versionCandidate = 2;

      while (attempts < 2) {
        const existingRecipientDrafts = await fetchExistingRecipientDrafts();
        const maxVersion = existingRecipientDrafts.reduce((max, proposal) => {
          const version = extractRecipientEditVersion(proposal, baseTitle);
          if (!version || version < 1) return max;
          return Math.max(max, version);
        }, 1);

        if (versionCandidate <= maxVersion) {
          versionCandidate = maxVersion + 1;
        }

        const candidateTitle = `${baseTitle} (${versionCandidate})`;
        const hasCollision = existingRecipientDrafts.some((proposal) => {
          const version = extractRecipientEditVersion(proposal, baseTitle);
          const title = asString(proposal?.title);
          return version === versionCandidate || title === candidateTitle;
        });

        if (!hasCollision) {
          return versionCandidate;
        }

        versionCandidate += 1;
        attempts += 1;
      }

      return versionCandidate;
    };

    const recipientEditVersion = await computeNextVersion();
    const draftTitle = `${baseTitle} (${recipientEditVersion})`;
    const sourceComparisonData = asObject(sourceComparison?.data);
    const nowIso = new Date().toISOString();
    const draftComparison = await base44.asServiceRole.entities.DocumentComparison.create({
      title: draftTitle,
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
      title: draftTitle,
      proposal_type: 'document_comparison',
      document_comparison_id: draftComparison?.id,
      template_id: sourceProposal?.template_id ?? sourceProposalData?.template_id ?? null,
      template_name: sourceProposal?.template_name ?? sourceProposalData?.template_name ?? null,
      created_by_user_id: user.id,
      party_a_user_id: user.id,
      party_a_email: asString(user?.email),
      party_b_user_id: sourcePartyAUserId,
      party_b_email: sourcePartyAEmail,
      status: 'draft',
      draft_step: 2,
      draft_updated_at: nowIso,
      is_recipient_edit_draft: true,
      recipient_edit_version: recipientEditVersion,
      sourceProposalId,
      source_proposal_id: sourceProposalId,
      data: {
        sourceProposalId,
        source_proposal_id: sourceProposalId,
        sourceDocumentComparisonId: sourceComparisonId,
        source_document_comparison_id: sourceComparisonId,
        recipientEditVersion: recipientEditVersion,
        recipient_edit_version: recipientEditVersion,
        recipientEditBaseTitle: baseTitle,
        recipient_edit_base_title: baseTitle,
        recipientEditDraft: true,
        recipient_edit_draft: true,
        created_from_shared_report: true
      }
    });

    return Response.json({
      ok: true,
      sourceProposalId,
      sourceDocumentComparisonId: sourceComparisonId,
      recipientEditVersion,
      draftTitle,
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
