import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIATION_EVIDENCE_MAX_ITEMS,
  MEDIATION_EVIDENCE_MAX_TOTAL_CHARS,
  buildEvidenceCandidatesFromContributions,
  buildPriorMediationEvidenceCandidate,
  retrieveMediationEvidence,
  retrieveMediationEvidenceSafely,
} from '../../server/_lib/mediation-evidence-retrieval.ts';
import {
  buildEvalPromptFromFactSheet,
  selectReportStyle,
} from '../../server/_lib/vertex-evaluation-v2-prompts.ts';

function factSheet(overrides = {}) {
  return {
    project_goal: 'Test a commercially workable partnership.',
    scope_deliverables: [],
    timeline: { start: null, duration: null, milestones: [] },
    constraints: [],
    success_criteria_kpis: [],
    vendor_preferences: [],
    assumptions: [],
    risks: [],
    open_questions: [],
    missing_info: [],
    source_coverage: {
      has_scope: true,
      has_timeline: false,
      has_kpis: false,
      has_constraints: false,
      has_risks: false,
    },
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    id: 'contribution:base',
    source_type: 'shared_contribution',
    source_label: 'Shared by Proposer',
    source_role: 'proposer',
    visibility: 'shared',
    text: 'The parties are considering a six-month pilot.',
    round_number: 1,
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

test('retriever ranks SaaS referral economics and client-protection evidence', () => {
  const packet = retrieveMediationEvidence({
    factSheet: factSheet({
      project_goal: 'Create a SaaS referral/channel partnership.',
      scope_deliverables: [
        'Referral commission and recurring revenue share are proposed.',
        'Lead attribution and client protection remain unresolved.',
      ],
      open_questions: ['When is commission earned?', 'How long does client protection last?'],
    }),
    sharedText: 'Current shared partnership terms.',
    confidentialText: 'Private commercial posture.',
    generatedAt: '2026-06-13T00:00:00.000Z',
    candidates: [
      candidate({
        id: 'shared:saas-terms',
        text:
          'A registered referral should earn commission when the customer pays. Client protection and non-circumvention should apply for twelve months. Recurring revenue share applies only while the partner provides active support.',
        round_number: 2,
      }),
      candidate({
        id: 'shared:generic',
        text: 'The teams are enthusiastic and would like to stay in touch.',
      }),
    ],
  });

  assert.equal(packet.retrieval_strategy, 'heuristic_commercial_terms_v1');
  assert.equal(packet.items[0]?.id, 'shared:saas-terms');
  assert.match(packet.items[0]?.excerpt || '', /registered referral/i);
  assert.equal(packet.items[0]?.extracted_terms.includes('economics'), true);
  assert.equal(packet.items[0]?.extracted_terms.includes('customer_attribution'), true);
  assert.match(packet.items[0]?.include_reason || '', /deal-specific/i);
  assert.equal(packet.items.some((item) => item.id === 'shared:generic'), false);
  assert.equal(packet.omitted_evidence_count, 1);
  assert.equal(packet.retrieval_warnings.includes('excluded_1_low_relevance_items'), true);
});

test('retriever supports implementation-ownership evidence without forcing generic delivery vocabulary', () => {
  const packet = retrieveMediationEvidence({
    factSheet: factSheet({
      project_goal: 'Run a partnership pilot with a defined customer handoff.',
      scope_deliverables: ['Training, onboarding, support, and implementation fee ownership need agreement.'],
    }),
    sharedText: 'Pilot context.',
    confidentialText: 'Private context.',
    candidates: [
      candidate({
        id: 'recipient:implementation',
        source_role: 'recipient',
        source_label: 'Shared by Recipient',
        text:
          'The recipient can own onboarding and training, but separately paid consulting should cover custom implementation work. The SaaS company should retain product support after customer handoff.',
      }),
      candidate({
        id: 'proposer:marketing',
        text: 'The platform has a modern interface and broad market potential.',
      }),
    ],
  });

  assert.equal(packet.items[0]?.id, 'recipient:implementation');
  assert.match(packet.items[0]?.excerpt || '', /onboarding and training/i);
  assert.match(packet.items[0]?.excerpt || '', /customer handoff/i);
});

test('retriever falls back safely when no structured evidence candidates are available', () => {
  const packet = retrieveMediationEvidence({
    factSheet: factSheet({ project_goal: 'Explore a vague commercial arrangement.' }),
    sharedText: 'The parties may consider a pilot, but no economics or responsibilities are defined.',
    confidentialText: 'There is limited private context and no confirmed commercial position.',
    candidates: [],
  });

  assert.equal(packet.retrieval_strategy, 'primary_context_fallback_v1');
  assert.equal(packet.retrieval_warnings.includes('structured_source_provenance_unavailable'), true);
  assert.equal(packet.evidence_count > 0, true);
});

test('retriever prefers the latest changed version while retaining conflicting material terms', () => {
  const packet = retrieveMediationEvidence({
    factSheet: factSheet({
      project_goal: 'Resolve changed pilot economics.',
      scope_deliverables: ['Commission changed between proposal versions.'],
    }),
    sharedText: 'Versioned proposal context.',
    confidentialText: 'Private context.',
    candidates: [
      candidate({
        id: 'version:1',
        round_number: 1,
        text: 'The first version proposed a 10% commission for signed customers.',
      }),
      candidate({
        id: 'version:3',
        round_number: 3,
        text: 'The latest version proposes a 15% commission only after the customer pays.',
      }),
    ],
  });

  assert.equal(packet.items[0]?.id, 'version:3');
  assert.equal(packet.items.some((item) => item.id === 'version:1'), true);
  assert.match(packet.items[0]?.dates_or_version_info || '', /round 3/i);
});

test('retriever surfaces a counterparty concern that is absent from generic proposal wording', () => {
  const packet = retrieveMediationEvidence({
    factSheet: factSheet({
      project_goal: 'Test a reseller partnership.',
      scope_deliverables: ['A reseller relationship and pilot are proposed.'],
    }),
    sharedText: 'The proposal describes a reseller pilot.',
    confidentialText: 'Private context.',
    candidates: [
      candidate({
        id: 'recipient:concern',
        source_role: 'recipient',
        source_label: 'Shared by Recipient',
        text:
          'The recipient is concerned the vendor could bypass registered leads and sell directly. Client attribution and a non-circumvention protection window must be agreed.',
      }),
      candidate({
        id: 'proposer:overview',
        text: 'The proposer wants a collaborative reseller relationship.',
      }),
    ],
  });

  assert.equal(packet.items[0]?.id, 'recipient:concern');
  assert.match(packet.items[0]?.excerpt || '', /bypass registered leads/i);
});

test('retriever deduplicates overlapping snippets and stays inside item and character budgets', () => {
  const repeated =
    'Commission is earned after customer payment, referral attribution is registered, and client protection lasts through the agreed protection window.';
  const candidates = Array.from({ length: 18 }, (_, index) =>
    candidate({
      id: `candidate:${index + 1}`,
      round_number: index + 1,
      text: index < 4 ? repeated : `${repeated} Additional commercial term ${index + 1}: ${'support '.repeat(120)}`,
    }),
  );
  const packet = retrieveMediationEvidence({
    factSheet: factSheet({
      scope_deliverables: ['Commission, referral attribution, and client protection.'],
    }),
    sharedText: repeated,
    confidentialText: 'Private context.',
    candidates,
  });

  assert.equal(packet.evidence_count <= MEDIATION_EVIDENCE_MAX_ITEMS, true);
  assert.equal(packet.character_budget_used <= MEDIATION_EVIDENCE_MAX_TOTAL_CHARS, true);
  assert.equal(packet.omitted_evidence_count > 0, true);
  assert.equal(
    packet.retrieval_warnings.some((warning) => warning.startsWith('deduplicated_')),
    true,
  );
});

test('contribution and prior-review adapters preserve auditable provenance and limitations', () => {
  const contributions = buildEvidenceCandidatesFromContributions([
    {
      id: 'contrib_123',
      authorRole: 'recipient',
      authorLabel: 'Recipient',
      visibility: 'shared',
      roundNumber: 4,
      sourceKind: 'uploaded_document',
      contentPayload: {
        label: 'Recipient commercial response',
        text: 'Commission payment timing and client protection remain unresolved.',
        files: [{ filename: 'commercial-response.pdf' }],
      },
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
    },
  ]);
  const prior = buildPriorMediationEvidenceCandidate({
    id: 'eval_456',
    roundNumber: 3,
    report: {
      report_title: 'Round three mediation',
      why: ['Where the Deal Is Stuck: Attribution remained unresolved.'],
      missing: ['How long does client protection last?'],
    },
    createdAt: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(contributions[0]?.id, 'contrib_123');
  assert.equal(contributions[0]?.file_names?.[0], 'commercial-response.pdf');
  assert.equal(contributions[0]?.round_number, 4);
  assert.equal(prior?.source_type, 'prior_mediation');
  assert.match(prior?.limitations?.[0] || '', /model-generated/i);
});

test('safe retrieval converts retriever exceptions into internal warnings without failing evaluation', () => {
  const packet = retrieveMediationEvidenceSafely(
    {
      factSheet: factSheet(),
      sharedText: 'Shared context.',
      confidentialText: 'Confidential context.',
      candidates: [candidate()],
      generatedAt: '2026-06-13T00:00:00.000Z',
    },
    () => {
      throw new Error('simulated retrieval failure');
    },
  );

  assert.equal(packet.evidence_count, 0);
  assert.deepEqual(packet.retrieval_warnings, ['retrieval_failed']);
  assert.equal(packet.generated_at, '2026-06-13T00:00:00.000Z');
});

test('retrieval adds deal-specific generation context across three commercial scenarios', () => {
  const scenarios = [
    {
      id: 'saas-attribution',
      factSheet: factSheet({ project_goal: 'Explore a SaaS channel partnership.' }),
      evidence:
        'The counterparty requires registered referral attribution and a nine-month client-protection window.',
      expected: 'nine-month client-protection window',
    },
    {
      id: 'pilot-ownership',
      factSheet: factSheet({ project_goal: 'Explore a commercial pilot.' }),
      evidence:
        'Onboarding is included, but custom implementation fees belong to the consulting partner and product support remains with the SaaS company.',
      expected: 'custom implementation fees belong to the consulting partner',
    },
    {
      id: 'changed-economics',
      factSheet: factSheet({ project_goal: 'Review changed reseller economics.' }),
      evidence:
        'The latest version changes commission from signature to first customer payment and removes upfront semi-exclusivity.',
      expected: 'changes commission from signature to first customer payment',
    },
  ];

  for (const scenario of scenarios) {
    const packet = retrieveMediationEvidence({
      factSheet: scenario.factSheet,
      sharedText: 'Generic shared proposal.',
      confidentialText: 'Generic private context.',
      candidates: [
        candidate({
          id: scenario.id,
          text: scenario.evidence,
          round_number: 2,
        }),
      ],
    });
    const withoutEvidence = buildEvalPromptFromFactSheet({
      factSheet: scenario.factSheet,
      chunks: { sharedChunks: [], confidentialChunks: [] },
      reportStyle: selectReportStyle(14),
    });
    const withEvidence = buildEvalPromptFromFactSheet({
      factSheet: scenario.factSheet,
      chunks: { sharedChunks: [], confidentialChunks: [] },
      reportStyle: selectReportStyle(14),
      retrievedEvidencePacket: packet,
    });

    assert.equal(withoutEvidence.includes(scenario.expected), false);
    assert.equal(withEvidence.includes(scenario.expected), true);
  }
});
