import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PARTY_A_KEYS = new Set(['a', 'party_a', 'proposer']);

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value);
  return raw ? raw.toLowerCase() : null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeParty(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isPartyAResponse(response: any): boolean {
  return PARTY_A_KEYS.has(normalizeParty(response?.entered_by_party || response?.author_party || 'a'));
}

function normalizeVisibility(value: unknown): string {
  return String(value || 'full').trim().toLowerCase() || 'full';
}

function isExplicitlyHidden(response: any): boolean {
  const visibility = normalizeVisibility(response?.visibility);
  if (['hidden', 'not_shared', 'private', 'confidential'].includes(visibility)) {
    return true;
  }

  const data = toObject(response?.data);
  const flags = [
    response?.is_hidden,
    response?.isHidden,
    response?.hidden_from_recipient,
    response?.hiddenFromRecipient,
    response?.is_confidential,
    response?.isConfidential,
    data.is_hidden,
    data.isHidden,
    data.hidden_from_recipient,
    data.hiddenFromRecipient,
    data.is_confidential,
    data.isConfidential
  ];

  return flags.some((flag) => flag === true);
}

function questionOwnerParty(question: any): 'a' | 'b' | 'shared' {
  const normalizedParty = String(
    question?.party ||
    question?.party_key ||
    question?.subject_party ||
    question?.for_party ||
    ''
  ).trim().toLowerCase();

  if (['b', 'party_b', 'recipient', 'counterparty', 'buyer', 'requirements_owner'].includes(normalizedParty)) {
    return 'b';
  }

  if (normalizedParty === 'shared' || normalizedParty === 'both') {
    return 'shared';
  }

  const roleType = String(question?.role_type || '').trim().toLowerCase();
  if (roleType === 'counterparty_observation') return 'b';
  if (roleType === 'shared_fact') return 'shared';

  if (question?.is_about_counterparty === true) return 'b';
  if (String(question?.applies_to_role || '').trim().toLowerCase() === 'recipient') return 'b';
  return 'a';
}

function dedupeById(records: any[]): any[] {
  const byId = new Map<string, any>();
  records.forEach((record, index) => {
    const id = asString(record?.id) || `fallback_${index}`;
    if (!byId.has(id)) {
      byId.set(id, record);
    }
  });

  return Array.from(byId.values());
}

function extractReportPayload(source: any): any {
  if (!source || typeof source !== 'object') return null;
  const data = toObject(source?.data);

  return (
    source?.output_report_json ||
    source?.evaluation_report_json ||
    source?.public_report_json ||
    source?.report ||
    data?.output_report_json ||
    data?.evaluation_report_json ||
    data?.public_report_json ||
    data?.report ||
    null
  );
}

function extractGeneratedAt(source: any): string | null {
  if (!source || typeof source !== 'object') return null;
  const data = toObject(source?.data);
  return asString(
    source?.generated_at ||
    source?.created_date ||
    data?.generated_at ||
    data?.created_date ||
    null
  );
}

function pickLatestReportCandidate(records: any[], sourceName: string) {
  const candidate = records?.[0] || null;
  if (!candidate) {
    return {
      source: sourceName,
      payload: null,
      generatedAt: null,
      id: null
    };
  }

  return {
    source: sourceName,
    payload: extractReportPayload(candidate),
    generatedAt: extractGeneratedAt(candidate),
    id: asString(candidate?.id)
  };
}

async function getProposalResponses(base44: any, sourceProposalId: string): Promise<any[]> {
  const buckets = await Promise.all([
    base44.asServiceRole.entities.ProposalResponse.filter({ proposal_id: sourceProposalId }, '-created_date'),
    base44.asServiceRole.entities.ProposalResponse.filter({ proposalId: sourceProposalId }, '-created_date'),
    base44.asServiceRole.entities.ProposalResponse.filter({ 'data.proposal_id': sourceProposalId }, '-created_date'),
    base44.asServiceRole.entities.ProposalResponse.filter({ 'data.proposalId': sourceProposalId }, '-created_date')
  ]);

  return dedupeById(buckets.flat());
}

async function getNextVersion(base44: any, sourceProposalId: string): Promise<number> {
  const rows = await Promise.all([
    base44.asServiceRole.entities.ProposalSnapshot.filter({ sourceProposalId }, '-created_date', 200).catch(() => []),
    base44.asServiceRole.entities.ProposalSnapshot.filter({ source_proposal_id: sourceProposalId }, '-created_date', 200).catch(() => []),
    base44.asServiceRole.entities.ProposalSnapshot.filter({ 'data.sourceProposalId': sourceProposalId }, '-created_date', 200).catch(() => []),
    base44.asServiceRole.entities.ProposalSnapshot.filter({ 'data.source_proposal_id': sourceProposalId }, '-created_date', 200).catch(() => [])
  ]);

  const allRows = dedupeById(rows.flat());
  const maxVersion = allRows.reduce((max: number, row: any) => {
    const data = toObject(row?.data);
    const candidate = toNumber(
      row?.version ??
      row?.snapshot_version ??
      row?.snapshotVersion ??
      data?.version ??
      data?.snapshot_version ??
      data?.snapshotVersion,
      0
    );
    return Math.max(max, candidate);
  }, 0);

  return maxVersion > 0 ? maxVersion + 1 : 1;
}

Deno.serve(async (req) => {
  const correlationId = `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const sourceProposalId = asString(body?.sourceProposalId || body?.source_proposal_id || body?.proposalId || body?.proposal_id);
    const recipientEmail = normalizeEmail(body?.recipientEmail || body?.recipient_email || null);
    const createdByUserId = asString(body?.createdByUserId || body?.created_by_user_id || user?.id);

    if (!sourceProposalId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL_ID',
        message: 'sourceProposalId is required',
        correlationId
      }, { status: 400 });
    }

    const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: sourceProposalId }, '-created_date', 1);
    const proposal = proposals?.[0] || null;
    if (!proposal) {
      return Response.json({
        ok: false,
        errorCode: 'PROPOSAL_NOT_FOUND',
        message: 'Source proposal not found',
        correlationId
      }, { status: 404 });
    }

    const templates = await base44.asServiceRole.entities.Template.list().catch(() => []);
    const template = templates.find((item: any) => item?.id === proposal?.template_id) || null;
    const templateQuestions = Array.isArray(template?.questions) ? template.questions : [];
    const questionLookup: Record<string, any> = {};
    templateQuestions.forEach((question: any) => {
      const questionId = asString(question?.id);
      if (!questionId) return;
      questionLookup[questionId] = question;
    });

    const allResponses = await getProposalResponses(base44, sourceProposalId);

    // Split responses by party
    const partyAResponseRows = allResponses.filter((r) => {
      const enteredBy = String(r?.entered_by_party || 'a').toLowerCase();
      return enteredBy === 'a' || enteredBy === 'party_a' || enteredBy === 'proposer';
    });

    const partyBResponseRows = allResponses.filter((r) => {
      const enteredBy = String(r?.entered_by_party || 'a').toLowerCase();
      return enteredBy === 'b' || enteredBy === 'party_b' || enteredBy === 'recipient';
    });

    // Build Party A responses with redaction
    const partyAResponses = partyAResponseRows.map((response) => {
      const questionId = asString(response?.question_id) || '';
      const question = questionLookup[questionId] || null;
      const visibility = normalizeVisibility(response?.visibility);
      const isHidden = visibility === 'hidden';
      const valueType = String(response?.value_type || '').trim().toLowerCase() === 'range' ? 'range' : 'text';

      const rawValue = response?.value ?? null;
      const rangeMin = response?.range_min ?? null;
      const rangeMax = response?.range_max ?? null;

      // Apply redaction for hidden fields
      if (isHidden) {
        return {
          sourceResponseId: asString(response?.id),
          questionId,
          label: asString(question?.label) || questionId,
          ownerParty: 'A',
          enteredByParty: 'a',
          visibility: 'hidden',
          valueType,
          value: null,
          rangeMin: null,
          rangeMax: null,
          valueSummary: null,
          redaction: 'hidden'
        };
      }

      // Non-hidden: include actual values
      let valueSummary: string | null = null;
      if (valueType === 'range') {
        valueSummary = (rangeMin !== null && rangeMin !== undefined && rangeMax !== null && rangeMax !== undefined)
          ? `${rangeMin} - ${rangeMax}`
          : null;
      } else {
        valueSummary = rawValue === null || rawValue === undefined ? null : String(rawValue);
      }

      return {
        sourceResponseId: asString(response?.id),
        questionId,
        label: asString(question?.label) || questionId,
        ownerParty: 'A',
        enteredByParty: 'a',
        visibility,
        valueType,
        value: rawValue === null || rawValue === undefined ? null : String(rawValue),
        rangeMin,
        rangeMax,
        valueSummary,
        redaction: 'none'
      };
    });

    // Build Party B editable schema
    const partyBQuestions = partyBResponseRows.map((response) => {
      const questionId = asString(response?.question_id) || '';
      const question = questionLookup[questionId] || null;
      const valueType = String(response?.value_type || '').trim().toLowerCase() === 'range' ? 'range' : 'text';

      return {
        questionId,
        label: asString(question?.label) || questionId,
        description: asString(question?.description) || null,
        fieldType: asString(question?.field_type) || 'text',
        valueType,
        required: Boolean(question?.required),
        supportsVisibility: Boolean(question?.supports_visibility),
        allowedValues: Array.isArray(question?.allowed_values) ? question.allowed_values : [],
        currentResponse: {
          id: asString(response?.id) || null,
          value: response?.value ?? null,
          rangeMin: response?.range_min ?? null,
          rangeMax: response?.range_max ?? null,
          visibility: normalizeVisibility(response?.visibility),
          enteredByParty: 'b',
          updatedAt: asString(response?.updated_date || response?.created_date)
        }
      };
    });

    let reportPayload: any = null;
    let reportGeneratedAt: string | null = null;
    let reportId: string | null = null;
    let reportSource = 'none';

    const sharedReports = await base44.asServiceRole.entities.EvaluationReportShared.filter(
      { proposal_id: sourceProposalId },
      '-created_date',
      1
    ).catch(() => []);
    const sharedCandidate = pickLatestReportCandidate(sharedReports, 'EvaluationReportShared.proposal_id');
    reportPayload = sharedCandidate.payload;
    reportGeneratedAt = sharedCandidate.generatedAt;
    reportId = sharedCandidate.id;
    reportSource = sharedCandidate.payload ? sharedCandidate.source : reportSource;

    if (!reportPayload) {
      const reportsByProposal = await base44.asServiceRole.entities.EvaluationReport.filter(
        { proposal_id: sourceProposalId },
        '-created_date',
        1
      ).catch(() => []);
      const candidate = pickLatestReportCandidate(reportsByProposal, 'EvaluationReport.proposal_id');
      reportPayload = candidate.payload;
      reportGeneratedAt = candidate.generatedAt || reportGeneratedAt;
      reportId = candidate.id || reportId;
      reportSource = candidate.payload ? candidate.source : reportSource;
    }

    if (!reportPayload) {
      const reportsByDataProposal = await base44.asServiceRole.entities.EvaluationReport.filter(
        { 'data.proposal_id': sourceProposalId },
        '-created_date',
        1
      ).catch(() => []);
      const candidate = pickLatestReportCandidate(reportsByDataProposal, 'EvaluationReport.data.proposal_id');
      reportPayload = candidate.payload;
      reportGeneratedAt = candidate.generatedAt || reportGeneratedAt;
      reportId = candidate.id || reportId;
      reportSource = candidate.payload ? candidate.source : reportSource;
    }

    const version = await getNextVersion(base44, sourceProposalId);
    const createdAt = new Date().toISOString();

    // Include document comparison if present
    let comparisonView: any = null;
    const docComparisonId = asString(proposal?.document_comparison_id);
    let comparison: any = null;

    if (docComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter(
        { id: docComparisonId },
        '-created_date',
        1
      ).catch(() => []);
      comparison = comparisons?.[0] || null;
    }

    // Fallback: try finding by proposal_id if not found
    if (!comparison) {
      const byProposal = await base44.asServiceRole.entities.DocumentComparison.filter(
        { proposal_id: sourceProposalId },
        '-created_date',
        1
      ).catch(() => []);
      comparison = byProposal?.[0] || null;
    }

    // Fallback: try data.proposal_id
    if (!comparison) {
      const byDataProposal = await base44.asServiceRole.entities.DocumentComparison.filter(
        { 'data.proposal_id': sourceProposalId },
        '-created_date',
        1
      ).catch(() => []);
      comparison = byDataProposal?.[0] || null;
    }

    if (comparison) {
      const rawDocAText = String(comparison.doc_a_plaintext ?? '');
      const rawDocBText = String(comparison.doc_b_plaintext ?? '');
      const rawDocASpans = Array.isArray(comparison.doc_a_spans_json) ? comparison.doc_a_spans_json : [];
      const rawDocBSpans = Array.isArray(comparison.doc_b_spans_json) ? comparison.doc_b_spans_json : [];

        // Remove hidden text
        const removeHidden = (text: string, spans: any[]) => {
          const normalizedSpans = spans
            .map((span: any) => {
              const level = String(span?.level || '').toLowerCase();
              if (!['hidden', 'confidential'].includes(level)) return null;
              const start = Number(span?.start);
              const end = Number(span?.end);
              if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
              return { start, end };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => a.start - b.start);

          if (normalizedSpans.length === 0) return { text, hiddenCount: 0 };

          let output = '';
          let cursor = 0;
          for (const span of normalizedSpans) {
            if (span.start > cursor) output += text.slice(cursor, span.start);
            cursor = Math.max(cursor, span.end);
          }
          if (cursor < text.length) output += text.slice(cursor);
          return { text: output, hiddenCount: normalizedSpans.length };
        };

        const redactedDocA = removeHidden(rawDocAText, rawDocASpans);
        const redactedDocB = removeHidden(rawDocBText, rawDocBSpans);

        comparisonView = {
          id: asString(comparison?.id) || docComparisonId,
          title: asString(comparison.title) || null,
          docA: {
            label: asString(comparison.party_a_label) || 'Document A',
            source: asString(comparison.doc_a_source) || 'typed',
            text: redactedDocA.text,
            hiddenCount: redactedDocA.hiddenCount
          },
          docB: {
            label: asString(comparison.party_b_label) || 'Document B',
            source: asString(comparison.doc_b_source) || 'typed',
            text: redactedDocB.text,
            hiddenCount: redactedDocB.hiddenCount
          }
        };
        }

    // Calculate field counts - count documents that have visible text
    const visibleResponseCount = partyAResponses.filter(r => r.visibility !== 'hidden').length;
    const hiddenResponseCount = partyAResponses.filter(r => r.visibility === 'hidden').length;
    
    let comparisonFieldCount = 0;
    let comparisonHiddenCount = 0;
    if (comparisonView) {
      if (comparisonView.docA?.text && comparisonView.docA.text.length > 0) comparisonFieldCount++;
      if (comparisonView.docB?.text && comparisonView.docB.text.length > 0) comparisonFieldCount++;
      comparisonHiddenCount = (comparisonView.docA?.hiddenCount || 0) + (comparisonView.docB?.hiddenCount || 0);
    }
    
    const totalVisible = visibleResponseCount + comparisonFieldCount;
    const totalHidden = hiddenResponseCount + comparisonHiddenCount;

    const snapshotData = {
      type: comparisonView ? 'document_comparison' : 'template',
      proposal: {
        sourceProposalId,
        title: asString(proposal?.title) || 'Untitled Proposal',
        templateId: asString(proposal?.template_id),
        templateName: asString(proposal?.template_name),
        status: asString(proposal?.status),
        createdDate: asString(proposal?.created_date),
        partyBEmail: normalizeEmail(proposal?.party_b_email),
        documentComparisonId: docComparisonId
      },
      partyAResponses: partyAResponses,
      partyBEditableSchema: {
        totalQuestions: partyBQuestions.length,
        editableQuestionIds: partyBQuestions.map(q => q.questionId),
        questions: partyBQuestions
      },
      comparisonView,
      reportData: {
        reportId,
        reportSource,
        generatedAt: reportGeneratedAt,
        report: reportPayload
      }
    };

    const visiblePartyACount = partyAResponses.filter(r => r.redaction !== 'hidden').length;
    const hiddenPartyACount = partyAResponses.filter(r => r.redaction === 'hidden').length;
    const partyBCount = partyBQuestions.length;

    const fieldCounts = {
      visible: visiblePartyACount + partyBCount + comparisonFieldCount,
      hidden: hiddenPartyACount + comparisonHiddenCount,
      templateResponses: visiblePartyACount,
      partyBFields: partyBCount,
      comparisonFields: comparisonFieldCount
    };

    const snapshotMeta = {
      title: asString(proposal?.title) || 'Untitled Proposal',
      templateName: asString(proposal?.template_name),
      templateId: asString(proposal?.template_id),
      sourceProposalId,
      recipientEmail: recipientEmail || normalizeEmail(proposal?.party_b_email),
      senderEmail: normalizeEmail(proposal?.party_a_email),
      version,
      createdAt,
      fieldCounts
    };

    console.log('[SnapshotBuild]', JSON.stringify({
      sourceProposalId,
      proposalType: snapshotData.type,
      templateId: asString(proposal?.template_id),
      responseCountFound: allResponses.length,
      partyACount: partyAResponseRows.length,
      partyBCount: partyBResponseRows.length,
      visibleCount: fieldCounts.visible,
      hiddenCount: fieldCounts.hidden,
      partyAVisible: visiblePartyACount,
      partyAHidden: hiddenPartyACount,
      partyBFields: partyBCount,
      comparisonFields: fieldCounts.comparisonFields,
      hasDocA: !!comparisonView?.docA?.text,
      hasDocB: !!comparisonView?.docB?.text,
      keys: Object.keys(snapshotData || {})
    }));

    const created = await base44.asServiceRole.entities.ProposalSnapshot.create({
      source_proposal_id: sourceProposalId,
      sourceProposalId: sourceProposalId,
      version,
      created_by_user_id: createdByUserId || asString(user?.id),
      recipient_email: recipientEmail || normalizeEmail(proposal?.party_b_email),
      share_link_id: null,
      snapshot_data: snapshotData,
      snapshotData: snapshotData,
      snapshot_meta: snapshotMeta,
      snapshotMeta: snapshotMeta
    });

    return Response.json({
      ok: true,
      snapshotId: asString(created?.id),
      version,
      sourceProposalId,
      fieldCounts,
      snapshot: {
        id: asString(created?.id),
        sourceProposalId,
        version,
        createdAt,
        recipientEmail: recipientEmail || normalizeEmail(proposal?.party_b_email),
        snapshotData,
        snapshotMeta
      },
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to create proposal snapshot',
      correlationId
    }, { status: 500 });
  }
});