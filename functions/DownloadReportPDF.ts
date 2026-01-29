import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  const correlationId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    
    const body = await req.json().catch(() => ({}));
    const { proposalId, evaluationItemId, documentComparisonId } = body;
    
    if (!proposalId && !evaluationItemId && !documentComparisonId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_ID',
        message: 'proposalId, evaluationItemId, or documentComparisonId required',
        correlationId
      }, { status: 400 });
    }

    const doc = new jsPDF();
    let title = 'Evaluation Report';
    
    // Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('PreMarket', 20, 15);
    doc.setFontSize(14);
    doc.text('AI Evaluation Report', 20, 25);
    
    doc.setTextColor(0, 0, 0);

    // Get report data
    let report = null;
    
    if (proposalId) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: proposalId });
      if (proposals[0]) {
        title = proposals[0].title || 'Proposal Report';
        const reports = await base44.asServiceRole.entities.EvaluationReportShared.filter({ 
          proposal_id: proposalId 
        }, '-created_date', 1);
        if (reports[0]?.output_report_json) {
          report = reports[0].output_report_json;
        }
      }
    } else if (documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ 
        id: documentComparisonId 
      });
      if (comparisons[0]) {
        title = comparisons[0].title || 'Document Comparison';
        report = comparisons[0].evaluation_report_json;
      }
    }

    // Title
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(title, 20, 45);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 52);
    
    let yPos = 65;
    
    if (report) {
      doc.setTextColor(0, 0, 0);
      
      // Summary
      if (report.summary) {
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Summary', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        if (report.summary.fit_level) {
          doc.text(`Fit Level: ${report.summary.fit_level}`, 20, yPos);
          yPos += 6;
        }
        if (report.summary.rationale) {
          const lines = doc.splitTextToSize(report.summary.rationale, 170);
          doc.text(lines, 20, yPos);
          yPos += lines.length * 5 + 5;
        }
        yPos += 5;
      }
      
      // Alignment points
      if (report.alignment_points?.length > 0) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Alignment Points', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        report.alignment_points.slice(0, 5).forEach(point => {
          if (yPos > 270) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(`• ${point.title}`, 20, yPos);
          yPos += 5;
          if (point.detail) {
            const lines = doc.splitTextToSize(point.detail, 160);
            doc.text(lines, 25, yPos);
            yPos += lines.length * 4 + 3;
          }
        });
        yPos += 5;
      }
      
      // Conflicts/Gaps
      if (report.conflicts_or_gaps?.length > 0) {
        if (yPos > 240) {
          doc.addPage();
          yPos = 20;
        }
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Conflicts & Gaps', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        report.conflicts_or_gaps.slice(0, 5).forEach(conflict => {
          if (yPos > 270) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(`• [${conflict.severity}] ${conflict.title}`, 20, yPos);
          yPos += 5;
          if (conflict.detail) {
            const lines = doc.splitTextToSize(conflict.detail, 160);
            doc.text(lines, 25, yPos);
            yPos += lines.length * 4 + 3;
          }
        });
      }
    } else {
      doc.setFontSize(10);
      doc.text('Report data not available', 20, yPos);
    }
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, 20, 285);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 150, 285);
    }
    
    const pdfBytes = doc.output('arraybuffer');
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));
    
    console.log(`[${correlationId}] PDF generated successfully`);
    
    return Response.json({
      ok: true,
      pdfBase64: base64Pdf,
      filename: `PreMarket_Report_${proposalId || documentComparisonId || 'eval'}.pdf`,
      correlationId
    });

  } catch (error) {
    console.error(`[${correlationId}] PDF generation error:`, error.message);
    return Response.json({
      ok: false,
      errorCode: 'PDF_GENERATION_FAILED',
      error: error.message,
      correlationId
    }, { status: 500 });
  }
});