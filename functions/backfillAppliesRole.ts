import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        const allQuestions = await base44.asServiceRole.entities.TemplateQuestion.list();
        
        const backfillLog = {
            total: allQuestions.length,
            fixed: 0,
            details: []
        };

        for (const q of allQuestions) {
            let needsUpdate = false;
            let newRole = q.applies_to_role;

            // If applies_to_role is missing or invalid
            if (!newRole || !['proposer', 'recipient', 'both'].includes(newRole)) {
                // Default to both
                newRole = 'both';
                needsUpdate = true;

                // Try to infer from section_id
                if (q.section_id) {
                    const section = q.section_id.toLowerCase();
                    if (section.includes('your') || section.includes('proposer') || section.includes('party a')) {
                        newRole = 'proposer';
                    } else if (section.includes('counterparty') || section.includes('recipient') || section.includes('party b')) {
                        newRole = 'recipient';
                    }
                }
            }

            if (needsUpdate) {
                await base44.asServiceRole.entities.TemplateQuestion.update(q.id, {
                    applies_to_role: newRole,
                    question_purpose: newRole === 'proposer' ? 'offer' : newRole === 'recipient' ? 'requirement' : 'shared_fact'
                });
                backfillLog.fixed++;
                backfillLog.details.push({
                    question_id: q.question_id,
                    label: q.label,
                    old_role: q.applies_to_role,
                    new_role: newRole
                });
            }
        }

        return Response.json({
            success: true,
            backfill_log: backfillLog
        });

    } catch (error) {
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});