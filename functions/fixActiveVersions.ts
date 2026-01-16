import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        // Only admins can run this
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        const templates = await base44.asServiceRole.entities.Template.list();
        const fixLog = {
            templates_processed: 0,
            versions_created: 0,
            pointers_fixed: 0,
            details: []
        };

        for (const template of templates) {
            try {
                let needsUpdate = false;
                let versionId = template.active_version_id;

                // If no active_version_id, find or create one
                if (!versionId) {
                    // Find existing version
                    const versions = await base44.asServiceRole.entities.TemplateVersion.filter({
                        template_id: template.id
                    });

                    // Prefer published or is_current, then latest by created_date
                    let targetVersion = versions.find(v => v.is_current) || versions[0];

                    // If no version exists, create one
                    if (!targetVersion) {
                        targetVersion = await base44.asServiceRole.entities.TemplateVersion.create({
                            template_id: template.id,
                            version_number: template.version || 1,
                            is_current: true,
                            changelog: 'Auto-created active version',
                            published_date: new Date().toISOString()
                        });
                        fixLog.versions_created++;
                    }

                    versionId = targetVersion.id;
                    needsUpdate = true;
                }

                // Update template with active_version_id
                if (needsUpdate) {
                    await base44.asServiceRole.entities.Template.update(template.id, {
                        active_version_id: versionId
                    });
                    fixLog.pointers_fixed++;
                }

                // Count normalized questions
                const questions = await base44.asServiceRole.entities.TemplateQuestion.filter({
                    template_version_id: versionId
                });

                fixLog.templates_processed++;
                fixLog.details.push({
                    template_id: template.id,
                    template_name: template.name,
                    active_version_id: versionId,
                    normalized_count: questions.length,
                    was_fixed: needsUpdate
                });

            } catch (error) {
                fixLog.details.push({
                    template_id: template.id,
                    template_name: template.name,
                    error: error.message
                });
            }
        }

        return Response.json({
            success: true,
            fix_log: fixLog
        });

    } catch (error) {
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});