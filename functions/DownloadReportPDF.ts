import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  const correlationId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    
    const body = await req.json().catch(() => ({}));
    const { proposalId, evaluationItemId, evaluationReportId, documentComparisonId } = body;
    
    if (!proposalId && !evaluationItemId && !evaluationReportId && !documentComparisonId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_ID',
        message: 'proposalId, evaluationItemId, evaluationReportId, or documentComparisonId required',
        correlationId
      }, { status: 400 });
    }

    const doc = new jsPDF();
    let title = 'AI Evaluation Report';
    
    // Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('PreMarket', 20, 15);
    doc.setFontSize(14);
    doc.text('AI Evaluation Report', 20, 25);
    
    doc.setTextColor(0, 0, 0);

    const normalizeRecord = (record: Record<string, unknown> | null | undefined, fallbackProposalId?: string | null) => {
      const data = record?.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
      return {
        id: (record?.id as string | undefined) ?? null,
        proposal_id: (record?.proposal_id as string | undefined) ?? (data.proposal_id as string | undefined) ?? fallbackProposalId ?? null,
        status: (record?.status as string | undefined) ?? (data.status as string | undefined) ?? null,
        generated_at: (record?.generated_at as string | undefined) ?? (data.generated_at as string | undefined) ?? null,
        created_date: (record?.created_date as string | undefined) ?? (data.created_date as string | undefined) ?? null,
        output_report_json:
          record?.output_report_json ??
          data.output_report_json ??
          record?.evaluation_report_json ??
          data.evaluation_report_json ??
          record?.public_report_json ??
          data.public_report_json ??
          null
      };
    };

    const toTimestamp = (value: unknown): number => {
      if (!value || typeof value !== 'string') return 0;
      const ts = Date.parse(value);
      return Number.isFinite(ts) ? ts : 0;
    };

    const isCompletedStatus = (status: unknown) => {
      if (typeof status !== 'string') return false;
      return ['succeeded', 'completed', 'success'].includes(status.toLowerCase());
    };

    const parseItemText = (item: unknown): string => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return String(obj.text ?? obj.title ?? obj.detail ?? obj.label ?? obj.reason ?? '').trim();
      }
      return String(item);
    };

    const percentValue = (value: unknown): string => {
      if (typeof value !== 'number' || Number.isNaN(value)) return 'N/A';
      const normalized = value <= 1 ? value * 100 : value;
      return `${Math.round(normalized)}%`;
    };

    let resolvedProposalId: string | null = proposalId || null;
    let proposalTitle = '';
    let generatedAt: string | null = null;
    const candidates: Array<{
      id: string | null;
      proposal_id: string | null;
      status: string | null;
      generated_at: string | null;
      created_date: string | null;
      output_report_json: unknown;
    }> = [];

    const addCandidates = (records: Array<Record<string, unknown>> | null | undefined, fallbackProposalId?: string | null) => {
      if (!records || records.length === 0) return;
      records.forEach((record) => {
        candidates.push(normalizeRecord(record, fallbackProposalId));
      });
    };

    // Resolve proposal from id first, then from evaluation item when needed.
    let proposalRecord: Record<string, unknown> | null = null;
    if (resolvedProposalId) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: resolvedProposalId });
      proposalRecord = proposals[0] ?? null;
    } else if (evaluationItemId) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evaluationItemId });
      const linkedProposalId = (items?.[0]?.linked_proposal_id as string | undefined) ?? null;
      if (linkedProposalId) {
        resolvedProposalId = linkedProposalId;
        const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: linkedProposalId });
        proposalRecord = proposals[0] ?? null;
      }
    }

    if (proposalRecord?.title && typeof proposalRecord.title === 'string') {
      proposalTitle = proposalRecord.title;
    }

    if (evaluationReportId) {
      const byReportId = await base44.asServiceRole.entities.EvaluationReport.filter({ id: evaluationReportId });
      addCandidates(byReportId as Array<Record<string, unknown>>, resolvedProposalId);
    }

    if (resolvedProposalId) {
      const reportsByProposal = await base44.asServiceRole.entities.EvaluationReport.filter({ proposal_id: resolvedProposalId }, '-created_date');
      addCandidates(reportsByProposal as Array<Record<string, unknown>>, resolvedProposalId);

      if (!reportsByProposal || reportsByProposal.length === 0) {
        const reportsByDataProposal = await base44.asServiceRole.entities.EvaluationReport.filter({ 'data.proposal_id': resolvedProposalId }, '-created_date');
        addCandidates(reportsByDataProposal as Array<Record<string, unknown>>, resolvedProposalId);
      }

      const shared = await base44.asServiceRole.entities.EvaluationReportShared.filter({ proposal_id: resolvedProposalId }, '-created_date');
      addCandidates(shared as Array<Record<string, unknown>>, resolvedProposalId);

      const fitCard = await base44.asServiceRole.entities.FitCardReportShared.filter({ proposal_id: resolvedProposalId }, '-created_date');
      addCandidates(fitCard as Array<Record<string, unknown>>, resolvedProposalId);

      const proposalDocumentComparisonId = (proposalRecord?.document_comparison_id as string | undefined) ?? null;
      if (proposalDocumentComparisonId) {
        const comparisonById = await base44.asServiceRole.entities.DocumentComparison.filter({ id: proposalDocumentComparisonId });
        addCandidates(comparisonById as Array<Record<string, unknown>>, resolvedProposalId);
      }

      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ proposal_id: resolvedProposalId }, '-created_date');
      addCandidates(comparisons as Array<Record<string, unknown>>, resolvedProposalId);
      if (!comparisons || comparisons.length === 0) {
        const comparisonsByDataProposal = await base44.asServiceRole.entities.DocumentComparison.filter({ 'data.proposal_id': resolvedProposalId }, '-created_date');
        addCandidates(comparisonsByDataProposal as Array<Record<string, unknown>>, resolvedProposalId);
      }
    }

    if (documentComparisonId) {
      const byComparisonId = await base44.asServiceRole.entities.DocumentComparison.filter({ id: documentComparisonId });
      addCandidates(byComparisonId as Array<Record<string, unknown>>, resolvedProposalId);
    }

    if (evaluationItemId) {
      const runs = await base44.asServiceRole.entities.EvaluationRun.filter({ evaluation_item_id: evaluationItemId }, '-created_date');
      addCandidates(runs as Array<Record<string, unknown>>, resolvedProposalId);
    }

    const sortedCandidates = candidates
      .filter((candidate) => candidate.output_report_json && typeof candidate.output_report_json === 'object')
      .sort((a, b) => toTimestamp(b.generated_at || b.created_date) - toTimestamp(a.generated_at || a.created_date));

    const completedCandidate =
      sortedCandidates.find((candidate) => isCompletedStatus(candidate.status)) ||
      sortedCandidates[0] ||
      null;

    const report = completedCandidate?.output_report_json && typeof completedCandidate.output_report_json === 'object'
      ? completedCandidate.output_report_json as Record<string, unknown>
      : null;

    if (proposalTitle) {
      title = proposalTitle;
    } else if (resolvedProposalId) {
      title = `Proposal ${resolvedProposalId}`;
    } else if (documentComparisonId) {
      title = `Document Comparison ${documentComparisonId}`;
    }

    generatedAt = completedCandidate?.generated_at || completedCandidate?.created_date || null;

    // Title
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(title, 20, 45);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date(generatedAt || Date.now()).toLocaleString()}`, 20, 52);
    
    let yPos = 64;

    const ensureRoom = (requiredHeight = 10) => {
      if (yPos + requiredHeight <= 275) return;
      doc.addPage();
      yPos = 20;
    };

    const renderSectionTitle = (sectionTitle: string) => {
      ensureRoom(8);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(13);
      doc.setFont(undefined, 'bold');
      doc.text(sectionTitle, 20, yPos);
      yPos += 8;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
    };

    const renderList = (items: unknown[] | undefined, emptyText = 'Not provided') => {
      if (!items || items.length === 0) {
        ensureRoom(6);
        doc.text(`- ${emptyText}`, 24, yPos);
        yPos += 6;
        return;
      }

      items.forEach((item) => {
        const text = parseItemText(item);
        if (!text) return;
        const lines = doc.splitTextToSize(`- ${text}`, 165);
        ensureRoom(Math.max(6, lines.length * 5 + 1));
        doc.text(lines, 24, yPos);
        yPos += Math.max(6, lines.length * 5 + 1);
      });
    };

    if (!report) {
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      doc.text('No AI report found for this proposal yet.', 20, yPos);
      yPos += 8;
    } else {
      const quality = (report.quality && typeof report.quality === 'object') ? report.quality as Record<string, unknown> : {};
      const summary = (report.summary && typeof report.summary === 'object') ? report.summary as Record<string, unknown> : {};

      renderSectionTitle('Quality Assessment');
      doc.setFontSize(10);
      doc.text(`Party A completeness: ${percentValue(quality.completeness_a)}`, 24, yPos);
      yPos += 6;
      doc.text(`Party B completeness: ${percentValue(quality.completeness_b)}`, 24, yPos);
      yPos += 6;
      doc.text(`Overall confidence: ${percentValue(quality.confidence_overall)}`, 24, yPos);
      yPos += 6;

      const confidenceReasoning = Array.isArray(quality.confidence_reasoning)
        ? quality.confidence_reasoning.map((item) => parseItemText(item)).filter(Boolean)
        : [];
      if (confidenceReasoning.length > 0) {
        const lines = doc.splitTextToSize(`Confidence reasoning: ${confidenceReasoning.join(' • ')}`, 165);
        ensureRoom(lines.length * 5 + 2);
        doc.text(lines, 24, yPos);
        yPos += lines.length * 5 + 2;
      }
      yPos += 2;

      renderSectionTitle('Executive Summary');
      const fitLevel = parseItemText(summary.fit_level || summary.fitLevel || summary.match_level || 'unknown');
      doc.text(`Fit level: ${fitLevel || 'unknown'}`, 24, yPos);
      yPos += 7;

      doc.setFont(undefined, 'bold');
      doc.text('Top match reasons', 24, yPos);
      yPos += 5;
      doc.setFont(undefined, 'normal');
      renderList(
        Array.isArray(summary.top_fit_reasons) ? summary.top_fit_reasons as unknown[] : [],
        'None'
      );

      doc.setFont(undefined, 'bold');
      ensureRoom(6);
      doc.text('Top blockers', 24, yPos);
      yPos += 5;
      doc.setFont(undefined, 'normal');
      renderList(
        Array.isArray(summary.top_blockers) ? summary.top_blockers as unknown[] : [],
        'None'
      );

      doc.setFont(undefined, 'bold');
      ensureRoom(6);
      doc.text('Next actions', 24, yPos);
      yPos += 5;
      doc.setFont(undefined, 'normal');
      renderList(
        Array.isArray(summary.next_actions) ? summary.next_actions as unknown[] : [],
        'None'
      );

      const flags = Array.isArray(report.flags) ? report.flags : [];
      if (flags.length > 0) {
        yPos += 2;
        renderSectionTitle('Flags & Risks');
        renderList(flags, 'None');
      }

      const followUpQuestions = Array.isArray(report.followup_questions) ? report.followup_questions : [];
      if (followUpQuestions.length > 0) {
        yPos += 2;
        renderSectionTitle('Recommended Follow-up Questions');
        renderList(followUpQuestions, 'None');
      }
    }
    
    // Footer
    const pageCount = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, 20, 285);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 150, 285);
    }
    
    const pdfBytes = doc.output('arraybuffer');
    const pdfU8 = new Uint8Array(pdfBytes);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < pdfU8.length; i += chunkSize) {
      binary += String.fromCharCode(...pdfU8.subarray(i, i + chunkSize));
    }
    const base64Pdf = btoa(binary);
    
    console.log(`[${correlationId}] PDF generated successfully`);
    
    return Response.json({
      ok: true,
      pdfBase64: base64Pdf,
      filename: `PreMarket_Report_${proposalId || documentComparisonId || 'eval'}.pdf`,
      reportId: completedCandidate?.id || null,
      generatedAt,
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] PDF generation error:`, err.message);
    return Response.json({
      ok: false,
      errorCode: 'PDF_GENERATION_FAILED',
      message: err.message,
      correlationId
    }, { status: 500 });
  }
});
