import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const SYSTEM_PROMPT = `SYSTEM / DEVELOPER PROMPT — VertexGemini3Evaluator (GenerateContent)
You generate a structured evaluation report for a pre-qualification proposal.
You MUST use only the provided template, responses, and optional computedSignals.
You MUST NOT invent facts. If data is missing/ambiguous, say "unknown".

NON-NEGOTIABLE RULES
1) Evidence-only: Every finding/flag/recommendation/follow-up question MUST cite relevant question_id(s).
2) No hallucinations: Do not claim certifications, controls, revenue, pricing, or documents unless present in responses or computedSignals.
3) Visibility compliance:
   - If visibility="hidden": do NOT reveal the value; set detail_level="redacted" and use a generic description.
   - If visibility="partial": summarize without specific numbers/URLs; detail_level="partial".
   - If visibility="full": you may summarize normally; detail_level="full".
4) Use computedSignals when provided for overlaps/gates/contradictions. Do not recompute complex logic if not provided.
5) Output MUST be valid JSON only. No prose outside JSON.

CONTEXT (how the workflow works)
- Party A (proposer) fills:
  - their own info (party="a")
  - AND initial info about Party B (still stored as responses, with updated_by="proposer")
- Party B can later verify/correct/update responses (updated_by="recipient" and/or verified_status changes)
- The report should reflect:
  - what is self-declared vs evidence-backed vs tier1_verified vs disputed
  - what is missing or unverified
  - what is blocked by hard constraints (if computedSignals includes gate_results)

OUTPUT JSON SCHEMA (MUST MATCH)
{
  "template_id": "string",
  "template_name": "string",
  "generated_at_iso": "string",
  "parties": { "a_label": "string", "b_label": "string" },
  "quality": {
    "completeness_a": 0.0,
    "completeness_b": 0.0,
    "confidence_overall": 0.0,
    "confidence_reasoning": ["string"],
    "missing_high_impact_question_ids": ["string"],
    "disputed_question_ids": ["string"]
  },
  "summary": {
    "overall_score_0_100": null,
    "fit_level": "high" | "medium" | "low" | "unknown",
    "top_fit_reasons": [{ "text": "string", "evidence_question_ids": ["string"] }],
    "top_blockers": [{ "text": "string", "evidence_question_ids": ["string"] }],
    "next_actions": ["string"]
  },
  "category_breakdown": [
    {
      "category_key": "string",
      "name": "string",
      "weight": 0.0,
      "score_0_100": null,
      "confidence_0_1": 0.0,
      "notes": ["string"],
      "evidence_question_ids": ["string"]
    }
  ],
  "gates": [{ "gate_key":"string", "outcome":"pass"|"fail"|"unknown", "message":"string", "evidence_question_ids":["string"] }],
  "overlaps_and_constraints": [{ "key":"string", "outcome":"pass"|"fail"|"unknown", "short_explanation":"string", "evidence_question_ids":["string"] }],
  "contradictions": [{ "key":"string", "severity":"low"|"med"|"high", "description":"string", "evidence_question_ids":["string"] }],
  "flags": [
    {
      "severity":"low"|"med"|"high",
      "type":"security"|"privacy"|"ops"|"commercial"|"integrity"|"other",
      "title":"string",
      "detail":"string",
      "detail_level":"full"|"partial"|"redacted",
      "evidence_question_ids":["string"]
    }
  ],
  "verification": {
    "summary": {
      "self_declared_count": 0,
      "evidence_attached_count": 0,
      "tier1_verified_count": 0,
      "disputed_count": 0
    },
    "evidence_requested": [{ "item":"string", "reason":"string", "related_question_ids":["string"] }]
  },
  "followup_questions": [
    {
      "priority":"high"|"med"|"low",
      "to_party":"a"|"b"|"both",
      "question_text":"string",
      "why_this_matters":"string",
      "targets": { "category_key":"string", "question_ids":["string"] }
    }
  ],
  "appendix": {
    "field_digest": [
      {
        "question_id":"string",
        "label":"string",
        "party":"a"|"b",
        "value_summary":"string",
        "visibility":"full"|"partial"|"hidden",
        "verified_status":"self_declared"|"evidence_attached"|"tier1_verified"|"disputed"|"unknown",
        "last_updated_by":"proposer"|"recipient"|"system"
      }
    ]
  }
}

HOW TO FILL THE REPORT:
- Completeness: answered_required / total_required per party
- Confidence: low if many required fields missing, disputes, or missing evidence
- Category breakdown: If rubric provided, use categories; else group by module_key
- DO NOT compute numeric scores yet; leave score_0_100 null
- Gates/overlaps/contradictions: use computedSignals if provided
- Flags: max 8, cite evidence_question_ids
- Follow-up questions: max 10, prioritize blockers and disputed items
- Respect visibility: hidden fields must have detail_level="redacted"

OUTPUT: Valid JSON only, no prose.`;

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

    // Create queued report
    const report = await base44.asServiceRole.entities.EvaluationReport.create({
      proposal_id,
      template_id: '',
      status: 'queued',
      system_prompt_version: 'v1_2026-01-18'
    });

    // Load data
    const [proposals, responses, templates] = await Promise.all([
      base44.entities.Proposal.filter({ id: proposal_id }),
      base44.entities.ProposalResponse.filter({ proposal_id }),
      base44.entities.Template.list()
    ]);

    const proposal = proposals[0];
    if (!proposal) {
      await base44.asServiceRole.entities.EvaluationReport.update(report.id, {
        status: 'failed',
        error_message: 'Proposal not found'
      });
      return Response.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const template = templates.find(t => t.id === proposal.template_id);
    if (!template) {
      await base44.asServiceRole.entities.EvaluationReport.update(report.id, {
        status: 'failed',
        error_message: 'Template not found'
      });
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    // Update report with template info and mark running
    await base44.asServiceRole.entities.EvaluationReport.update(report.id, {
      template_id: template.id,
      template_version: template.updated_date || template.created_date,
      rubric_version: template.rubric_version || 'default',
      status: 'running'
    });

    // Build input snapshot
    const inputSnapshot = {
      template: {
        id: template.id,
        name: template.name,
        party_a_label: template.party_a_label || 'Party A',
        party_b_label: template.party_b_label || 'Party B',
        questions: template.questions || []
      },
      responses: responses.map(r => ({
        question_id: r.question_id,
        party: r.entered_by_party,
        value: r.value,
        value_type: r.value_type,
        range_min: r.range_min,
        range_max: r.range_max,
        visibility: r.visibility || 'full',
        updated_by: r.entered_by_party === 'a' ? 'proposer' : 'recipient',
        verified_status: 'self_declared'
      })),
      rubric: template.evaluation_rubric_json || null,
      computedSignals: null
    };

    // Build prompt
    const promptText = `${SYSTEM_PROMPT}

INPUTS (JSON):
${JSON.stringify(inputSnapshot, null, 2)}

Generate the evaluation report as valid JSON matching the schema exactly.`;

    // Call Vertex AI via GenerateContent
    const result = await base44.asServiceRole.functions.invoke('GenerateContent', {
      projectId: 'premarket-484606',
      location: 'us-central1',
      model: 'gemini-2.0-flash-exp',
      text: promptText,
      temperature: 0.2,
      maxOutputTokens: 8000
    });

    if (!result.ok) {
      await base44.asServiceRole.entities.EvaluationReport.update(report.id, {
        status: 'failed',
        error_message: `Vertex AI error: ${JSON.stringify(result.raw)}`,
        raw_output: result.outputText || ''
      });
      return Response.json({ 
        error: 'Evaluation failed',
        reportId: report.id 
      }, { status: 500 });
    }

    // Parse JSON output
    let outputReport;
    try {
      // Extract JSON from markdown if needed
      let jsonText = result.outputText || '';
      if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].split('```')[0].trim();
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.split('```')[1].split('```')[0].trim();
      }
      
      outputReport = JSON.parse(jsonText);

      // Basic validation
      if (!outputReport.template_id || !outputReport.summary || !outputReport.quality) {
        throw new Error('Invalid report structure: missing required fields');
      }

      // Update report with success
      await base44.asServiceRole.entities.EvaluationReport.update(report.id, {
        status: 'succeeded',
        input_snapshot_json: inputSnapshot,
        output_report_json: outputReport,
        confidence_overall: outputReport.quality?.confidence_overall || 0,
        generated_at: new Date().toISOString()
      });

      return Response.json({
        success: true,
        reportId: report.id,
        report: outputReport
      });

    } catch (parseError) {
      await base44.asServiceRole.entities.EvaluationReport.update(report.id, {
        status: 'failed',
        error_message: `JSON parse error: ${parseError.message}`,
        raw_output: result.outputText || ''
      });
      
      return Response.json({
        error: 'Failed to parse evaluation report',
        reportId: report.id,
        parseError: parseError.message
      }, { status: 500 });
    }

  } catch (error) {
    console.error('EvaluateProposal error:', error);
    return Response.json({
      error: error.message
    }, { status: 500 });
  }
});