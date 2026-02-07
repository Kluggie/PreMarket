import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const SYSTEM_PROMPT = `SYSTEM PROMPT — Shared FitCard Evaluation (Profile Matching)

You generate ONE shared FitCard report for a profile matching proposal.
Both parties (Profile Owner and Requirements Owner) will see the same report.

PRIVACY-CRITICAL RULES:
1) You may ANALYZE hidden/partial values to inform your assessment, BUT:
   - Never output raw values, exact numbers, URLs, or filenames from hidden/partial responses
   - Summarize findings generically (e.g., "Compensation expectations align" not "$120k")
2) Every finding, flag, or follow-up question MUST cite evidence_question_ids
3) Output ONLY valid JSON matching the schema exactly
4) If data is missing or ambiguous, mark as "unknown" or note in gaps

CONTEXT:
- Mode: One of "Job Fit", "Beta Access Fit", "Program/Accelerator Fit", "Grant/Scholarship Fit"
- Shared core questions apply to all modes
- Mode-specific questions only appear for the selected mode
- Both parties answer the same questions; this is a mutual evaluation

OUTPUT SCHEMA (MUST MATCH):
{
  "template_id": "string",
  "template_name": "string",
  "mode": "string",
  "generated_at_iso": "string",
  "summary": {
    "fit_score_0_100": null or number,
    "fit_level": "high" | "medium" | "low" | "unknown",
    "top_strengths": [{"text": "string", "evidence_question_ids": ["string"]}],
    "key_gaps": [{"text": "string", "evidence_question_ids": ["string"]}]
  },
  "must_haves_check": {
    "satisfied_count": number,
    "total_count": number,
    "missing_items": [{"text": "string", "evidence_question_ids": ["string"]}]
  },
  "flags": [
    {
      "severity": "low" | "med" | "high",
      "type": "mismatch" | "missing_data" | "privacy_concern" | "other",
      "title": "string",
      "detail": "string",
      "detail_level": "full" | "partial" | "redacted",
      "evidence_question_ids": ["string"]
    }
  ],
  "next_steps": ["string"],
  "followup_questions": [
    {
      "priority": "high" | "med" | "low",
      "to_party": "a" | "b" | "both",
      "question_text": "string",
      "why_this_matters": "string",
      "targets": {"question_ids": ["string"]}
    }
  ]
}

HOW TO FILL:
- fit_score_0_100: Can be null initially if insufficient data; otherwise 0-100 compatibility score
- fit_level: Based on mode-specific criteria (alignment, gaps, flags)
- must_haves_check: Compare stated must-haves from both parties
- Flags: Max 8, prioritize high severity
- Follow-up questions: Max 10, prioritize high priority
- Respect privacy: hidden/partial fields → detail_level="redacted" or "partial", no raw values

Return ONLY the JSON. No markdown, no extra text.`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { proposal_id } = await req.json();

    if (!proposal_id) {
      return Response.json({ error: 'Missing proposal_id' }, { status: 400 });
    }

    // Load data using service role
    const [proposals, responses, templates] = await Promise.all([
      base44.asServiceRole.entities.Proposal.filter({ id: proposal_id }),
      base44.asServiceRole.entities.ProposalResponse.filter({ proposal_id }),
      base44.asServiceRole.entities.Template.list()
    ]);

    const proposal = proposals[0];
    if (!proposal) {
      return Response.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const template = templates.find(t => t.id === proposal.template_id);
    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    // Check if this is a profile matching template
    const isProfileMatchingTemplate = template.slug === 'universal_profile_matching' || 
                                       template.template_key === 'universal_profile_matching';

    if (!isProfileMatchingTemplate) {
      return Response.json({ error: 'This function is only for Universal Profile Matching template' }, { status: 400 });
    }

    // Extract mode from responses
    const modeResponse = responses.find(r => r.question_id === 'mode');
    const modeValue = modeResponse?.value || 'Unknown';

    // Check for existing report
    const existingReports = await base44.asServiceRole.entities.FitCardReportShared.filter({ proposal_id });
    let report;
    
    if (existingReports.length > 0) {
      report = existingReports[0];
      await base44.asServiceRole.entities.FitCardReportShared.update(report.id, {
        status: 'running'
      });
    } else {
      report = await base44.asServiceRole.entities.FitCardReportShared.create({
        proposal_id,
        template_id: template.id,
        template_name: template.name,
        mode_value: modeValue,
        status: 'running',
        prompt_version: 'v1_2026-01-23',
        model_name: 'gemini-3-flash-preview'
      });
    }

    // Build input snapshot
    const inputSnapshot = {
      template: {
        id: template.id,
        name: template.name,
        party_a_label: template.party_a_label || 'Profile Owner',
        party_b_label: template.party_b_label || 'Requirements Owner',
        questions: template.questions?.map(q => ({
          id: q.id,
          label: q.label,
          module_key: q.module_key,
          required: q.required,
          supports_visibility: q.supports_visibility
        })) || []
      },
      mode: modeValue,
      responses: responses.map(r => {
        const question = template.questions?.find(q => q.id === r.question_id);
        const visibility = r.visibility || 'full';
        
        return {
          question_id: r.question_id,
          party: r.entered_by_party,
          value: visibility === 'hidden' ? '[HIDDEN - analyze but do not reveal]' : r.value,
          value_type: r.value_type,
          visibility: visibility,
          question_label: question?.label || r.question_id
        };
      }).sort((a, b) => a.question_id.localeCompare(b.question_id))
    };

    // Build prompt
    const promptText = `${SYSTEM_PROMPT}

INPUTS (JSON):
${JSON.stringify(inputSnapshot, null, 2)}

Generate the FitCard evaluation report as valid JSON matching the schema exactly.`;

    // Call Vertex AI via GenerateContent
    const result = await base44.asServiceRole.functions.invoke('GenerateContent', {
      projectId: 'premarket-484606',
      location: 'global',
      model: 'gemini-3-flash-preview',
      text: promptText,
      temperature: 0.2,
      maxOutputTokens: 8000
    });

    if (!result.data || !result.data.ok) {
      const errorMsg = result.data?.error || 'Unknown Vertex AI error';
      await base44.asServiceRole.entities.FitCardReportShared.update(report.id, {
        status: 'failed',
        error_message: errorMsg
      });
      return Response.json({ 
        error: 'Evaluation failed',
        reportId: report.id,
        details: errorMsg
      }, { status: 500 });
    }

    // Parse JSON output
    let outputReport;
    try {
      let jsonText = result.data.outputText || '';
      if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].split('```')[0].trim();
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.split('```')[1].split('```')[0].trim();
      }
      
      outputReport = JSON.parse(jsonText);

      // Basic validation
      if (!outputReport.template_id || !outputReport.summary) {
        throw new Error('Invalid report structure: missing required fields');
      }

      // Privacy check: ensure hidden values not leaked
      const hiddenResponses = responses.filter(r => r.visibility === 'hidden');
      const reportStr = JSON.stringify(outputReport).toLowerCase();
      
      for (const hidden of hiddenResponses) {
        if (hidden.value && hidden.value.length > 5) {
          const hiddenLower = String(hidden.value).toLowerCase();
          if (reportStr.includes(hiddenLower)) {
            throw new Error('Privacy violation: hidden value detected in report');
          }
        }
      }

      // Update report with success
      await base44.asServiceRole.entities.FitCardReportShared.update(report.id, {
        status: 'succeeded',
        output_report_json: outputReport,
        generated_at: new Date().toISOString()
      });

      return Response.json({
        success: true,
        reportId: report.id,
        report: outputReport
      });

    } catch (parseError) {
      await base44.asServiceRole.entities.FitCardReportShared.update(report.id, {
        status: 'failed',
        error_message: `JSON parse error: ${parseError.message}`
      });
      
      return Response.json({
        error: 'Failed to parse evaluation report',
        reportId: report.id,
        parseError: parseError.message
      }, { status: 500 });
    }

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('EvaluateFitCardShared error:', error);
    return Response.json({
      error: err.message
    }, { status: 500 });
  }
});