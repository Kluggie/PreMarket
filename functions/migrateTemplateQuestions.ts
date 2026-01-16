import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        // Only admins can run migration
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        // Parse request body for template_id filter
        let requestData = {};
        try {
            requestData = await req.json();
        } catch {
            // No body is fine, migrate all
        }

        // Get all templates or specific one
        const templates = requestData.template_id 
            ? [await base44.asServiceRole.entities.Template.get(requestData.template_id)]
            : await base44.asServiceRole.entities.Template.list();
        
        const migrationLog = {
            templates_processed: 0,
            versions_created: 0,
            questions_created: 0,
            errors: [],
            details: []
        };

        for (const template of templates) {
            try {
                // Skip if no questions in embedded data
                if (!template.questions || template.questions.length === 0) {
                    migrationLog.details.push({
                        template_id: template.id,
                        template_name: template.name,
                        status: 'skipped',
                        reason: 'no_embedded_questions'
                    });
                    continue;
                }

                // Find or create the active version
                let version;
                
                // First check if template has active_version_id set
                if (template.active_version_id) {
                    version = await base44.asServiceRole.entities.TemplateVersion.get(template.active_version_id);
                }
                
                // If not, find existing version
                if (!version) {
                    const versions = await base44.asServiceRole.entities.TemplateVersion.filter({
                        template_id: template.id,
                        is_current: true
                    });
                    version = versions[0];
                }
                
                // If still no version, create one
                if (!version) {
                    version = await base44.asServiceRole.entities.TemplateVersion.create({
                        template_id: template.id,
                        version_number: template.version || 1,
                        is_current: true,
                        changelog: 'Initial migration from embedded questions',
                        published_date: new Date().toISOString()
                    });
                    migrationLog.versions_created++;
                    
                    // Update template with active_version_id
                    await base44.asServiceRole.entities.Template.update(template.id, {
                        active_version_id: version.id
                    });
                }

                // Check if questions already migrated for this version
                const existingQuestions = await base44.asServiceRole.entities.TemplateQuestion.filter({
                    template_version_id: version.id
                });

                if (existingQuestions.length > 0) {
                    migrationLog.details.push({
                        template_id: template.id,
                        template_name: template.name,
                        status: 'skipped',
                        reason: 'already_migrated',
                        existing_count: existingQuestions.length,
                        version_id: version.id
                    });
                    continue;
                }

                // Migrate each question (idempotent - check for existing by question_id)
                let order = 0;
                for (const q of template.questions) {
                    // Check if this question already exists for this version
                    const existingForVersion = await base44.asServiceRole.entities.TemplateQuestion.filter({
                        template_version_id: version.id,
                        question_id: q.id
                    });

                    if (existingForVersion.length > 0) {
                        continue; // Skip, already migrated
                    }

                    // Map party to applies_to_role and question_purpose
                    let applies_to_role = 'both';
                    let question_purpose = 'shared_fact';
                    
                    if (q.party === 'a') {
                        applies_to_role = 'proposer';
                        question_purpose = 'offer';
                    } else if (q.party === 'b') {
                        applies_to_role = 'recipient';
                        question_purpose = 'requirement';
                    }

                    // Determine verification mode - default to simple_ack for proposer questions
                    let verification_mode = applies_to_role === 'proposer' ? 'simple_ack' : 'none';
                    if (q.evidence_requirement === 'required') {
                        verification_mode = 'evidence_required';
                    } else if (q.evidence_requirement === 'recommended') {
                        verification_mode = 'evidence_recommended';
                    } else if (q.evidence_requirement === 'optional') {
                        verification_mode = 'evidence_optional';
                    }

                    await base44.asServiceRole.entities.TemplateQuestion.create({
                        template_id: template.id,
                        template_version_id: version.id,
                        question_id: q.id,
                        section_id: q.section_id || q.section || 'general',
                        order: order++,
                        label: q.label,
                        help_text: q.description || q.help_text || '',
                        field_type: q.field_type,
                        options_json: q.options ? JSON.stringify(q.options) : '[]',
                        required: q.required || false,
                        supports_range: q.supports_range || false,
                        applies_to_role: applies_to_role,
                        question_purpose: question_purpose,
                        comparable_key: q.comparable_key || null,
                        visibility_default: q.default_visibility || 'full',
                        verification_mode: verification_mode,
                        verifiable: applies_to_role === 'proposer',
                        recipient_can_verify: applies_to_role === 'proposer',
                        evidence_requirement: q.evidence_requirement || 'optional',
                        weight: q.weight || null
                    });
                    migrationLog.questions_created++;
                }

                // Update template with active_version_id if not set
                if (!template.active_version_id) {
                    await base44.asServiceRole.entities.Template.update(template.id, {
                        active_version_id: version.id
                    });
                }

                migrationLog.templates_processed++;
                migrationLog.details.push({
                    template_id: template.id,
                    template_name: template.name,
                    status: 'success',
                    questions_migrated: template.questions.length,
                    version_id: version.id
                });

            } catch (error) {
                migrationLog.errors.push({
                    template_id: template.id,
                    template_name: template.name,
                    error: error.message
                });
            }
        }

        return Response.json({
            success: true,
            migration_log: migrationLog
        });

    } catch (error) {
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});