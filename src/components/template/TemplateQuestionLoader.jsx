import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook to load template questions from TemplateQuestion entity
 * Falls back to embedded template.questions if migration hasn't run yet
 */
export function useTemplateQuestions(template) {
  const { data: questionRecords, isLoading } = useQuery({
    queryKey: ['template-questions', template?.id, template?.active_version_id],
    queryFn: async () => {
      if (!template?.id) return [];
      
      // Load from active version if available
      let versionId = template.active_version_id;
      
      // If no active_version_id, find current version
      if (!versionId) {
        const versions = await base44.entities.TemplateVersion.filter({
          template_id: template.id,
          is_current: true
        });
        versionId = versions[0]?.id;
      }
      
      // Try to load from TemplateQuestion entity for this version
      const questions = versionId 
        ? await base44.entities.TemplateQuestion.filter({
            template_version_id: versionId
          })
        : await base44.entities.TemplateQuestion.filter({
            template_id: template.id
          });
      
      return questions.sort((a, b) => (a.order || 0) - (b.order || 0));
    },
    enabled: !!template?.id
  });

  // If no questions found in TemplateQuestion entity, fall back to embedded
  const questions = questionRecords?.length > 0 
    ? questionRecords.map(q => {
        // Map applies_to_role to party (a/b/both)
        let party = 'both';
        if (q.applies_to_role === 'proposer') party = 'a';
        else if (q.applies_to_role === 'recipient') party = 'b';
        else if (q.applies_to_role === 'both') party = 'both';
        // If applies_to_role is missing/invalid, default to 'both'
        else party = 'both';

        return {
          id: q.question_id,
          section: q.section_id,
          section_id: q.section_id,
          party: party,
          applies_to_role: q.applies_to_role,
          label: q.label,
          description: q.help_text,
          field_type: q.field_type,
          options: q.options_json ? JSON.parse(q.options_json) : [],
          required: q.required,
          supports_range: q.supports_range,
          supports_visibility: true,
          default_visibility: q.visibility_default,
          evidence_requirement: q.evidence_requirement,
          verifiable: q.verifiable,
          recipient_can_verify: q.recipient_can_verify,
          weight: q.weight
        };
      })
    : template?.questions || [];

  return { questions, isLoading };
}