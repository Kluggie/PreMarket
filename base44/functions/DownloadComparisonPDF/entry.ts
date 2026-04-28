import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';
import 'npm:jspdf-autotable@3.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { comparisonId } = await req.json();
    
    if (!comparisonId) {
      return Response.json({ error: 'Missing comparisonId' }, { status: 400 });
    }

    // Load comparison
    const comparisons = await base44.entities.DocumentComparison.filter({ id: comparisonId });
    const comparison = comparisons[0];
    
    if (!comparison) {
      return Response.json({ error: 'Comparison not found' }, { status: 404 });
    }

    const report = comparison.evaluation_report_json;
    
    if (!report) {
      return Response.json({ error: 'No evaluation report available' }, { status: 400 });
    }

    // Create PDF
    const doc = new jsPDF();
    let y = 20;

    // Title
    doc.setFontSize(20);
    doc.text(comparison.title || 'Document Comparison Report', 20, y);
    y += 15;

    // Metadata
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, y);
    y += 6;
    doc.text(`${comparison.party_a_label} vs ${comparison.party_b_label}`, 20, y);
    y += 15;

    // Summary
    if (report.summary) {
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text('Summary', 20, y);
      y += 8;
      
      doc.setFontSize(10);
      if (report.summary.match_level) {
        doc.text(`Match Level: ${report.summary.match_level}`, 20, y);
        y += 6;
      }
      if (report.summary.match_score_0_100 !== null && report.summary.match_score_0_100 !== undefined) {
        doc.text(`Match Score: ${Math.round(report.summary.match_score_0_100)}%`, 20, y);
        y += 6;
      }
      if (report.summary.rationale) {
        doc.setFontSize(9);
        const lines = doc.splitTextToSize(report.summary.rationale, 170);
        doc.text(lines, 20, y);
        y += lines.length * 5 + 10;
      }
    }

    // Alignment Points
    if (report.alignment_points?.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text('Alignment Points', 20, y);
      y += 10;
      
      doc.setFontSize(9);
      report.alignment_points.forEach((point, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        
        doc.setTextColor(0, 150, 0);
        doc.text(`✓ ${point.title}`, 20, y);
        y += 6;
        
        doc.setTextColor(50);
        const lines = doc.splitTextToSize(point.detail, 170);
        doc.text(lines, 20, y);
        y += lines.length * 5 + 6;
      });
    }

    // Conflicts or Gaps
    if (report.conflicts_or_gaps?.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text('Conflicts & Gaps', 20, y);
      y += 10;
      
      doc.setFontSize(9);
      report.conflicts_or_gaps.forEach((conflict) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        
        const color: [number, number, number] = conflict.severity === 'high' ? [200, 0, 0] : 
          conflict.severity === 'medium' ? [200, 150, 0] : [0, 100, 200];
        doc.setTextColor(...color);
        doc.text(`⚠ ${conflict.title} [${conflict.severity?.toUpperCase()}]`, 20, y);
        y += 6;
        
        doc.setTextColor(50);
        const lines = doc.splitTextToSize(conflict.detail, 170);
        doc.text(lines, 20, y);
        y += lines.length * 5 + 6;
      });
    }

    // Follow-up Requests
    if (report.followup_requests?.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text('Recommended Follow-up', 20, y);
      y += 10;
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      report.followup_requests.forEach((request, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(`${idx + 1}. ${request}`, 20, y);
        y += 6;
      });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="comparison-report-${comparisonId}.pdf"`
      }
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[DownloadComparisonPDF] Error:', error);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
