export const DEFAULT_TEMPLATE_DEFINITIONS = [
  {
    id: 'builtin:universal_ma_prequal',
    slug: 'universal_ma_prequal',
    category: 'm_and_a',
    name: 'M&A Pre-Qualification',
    description:
      'Standardized intake for acquirer and target pre-qualification, including strategy, size, and readiness.',
    partyALabel: 'Acquirer',
    partyBLabel: 'Target',
    sortOrder: 10,
    sections: [
      {
        key: 'deal_overview',
        title: 'Deal Overview',
        sortOrder: 10,
        questions: [
          {
            key: 'thesis',
            label: 'Investment Thesis',
            description: 'Describe strategic rationale for this transaction.',
            fieldType: 'textarea',
            valueType: 'text',
            required: true,
            sortOrder: 10,
          },
          {
            key: 'target_range',
            label: 'Target Revenue Range',
            description: 'Preferred revenue profile for a target.',
            fieldType: 'text',
            valueType: 'text',
            required: false,
            sortOrder: 20,
          },
        ],
      },
      {
        key: 'process',
        title: 'Process Readiness',
        sortOrder: 20,
        questions: [
          {
            key: 'timeline',
            label: 'Expected Timeline',
            description: 'Preferred timeline to close.',
            fieldType: 'text',
            valueType: 'text',
            required: false,
            sortOrder: 10,
          },
        ],
      },
    ],
  },
  {
    id: 'builtin:universal_recruiting_prequal',
    slug: 'universal_recruiting_prequal',
    category: 'recruiting',
    name: 'Talent Acquisition Pre-Qualification',
    description:
      'Evaluate role fit, compensation ranges, and urgency before sharing full identifying details.',
    partyALabel: 'Hiring Team',
    partyBLabel: 'Candidate',
    sortOrder: 20,
    sections: [
      {
        key: 'role',
        title: 'Role Requirements',
        sortOrder: 10,
        questions: [
          {
            key: 'must_have_skills',
            label: 'Must-Have Skills',
            description: 'Critical capabilities required for the role.',
            fieldType: 'textarea',
            valueType: 'text',
            required: true,
            sortOrder: 10,
          },
          {
            key: 'comp_range',
            label: 'Compensation Range',
            description: 'Expected compensation range.',
            fieldType: 'text',
            valueType: 'text',
            required: false,
            sortOrder: 20,
          },
        ],
      },
    ],
  },
];

export function getDefaultTemplateById(templateId: string) {
  const normalized = String(templateId || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    DEFAULT_TEMPLATE_DEFINITIONS.find((definition) => {
      return (
        definition.id.toLowerCase() === normalized ||
        definition.slug.toLowerCase() === normalized
      );
    }) || null
  );
}
