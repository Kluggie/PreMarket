import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook to load template questions from TemplateQuestion entity
 * Falls back to embedded template.questions if migration hasn't run yet
 */
export function useTemplateQuestions(template) {
  const { data: questionRecords, isLoading } = useQuery({
    queryKey: ['template-questions', template?.id],
    queryFn: async () => {
      if (!template?.id) return [];
      
      // Try to load from TemplateQuestion entity
      const questions = await base44.entities.TemplateQuestion.filter({
        template_id: template.id
      });
      
      return questions.sort((a, b) => (a.order || 0) - (b.order || 0));
    },
    enabled: !!template?.id
  });

  // If no questions found in TemplateQuestion entity, fall back to embedded
  const questions = questionRecords?.length > 0 
    ? questionRecords.map(q => ({
        id: q.question_id,
        section: q.section_id,
        section_id: q.section_id,
        party: q.applies_to_role === 'proposer' ? 'a' : q.applies_to_role === 'recipient' ? 'b' : 'both',
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
      }))
    : template?.questions || [];

  return { questions, isLoading };
}