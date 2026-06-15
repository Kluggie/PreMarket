import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildProposalStage1Texts } from '../../server/routes/proposals/[id]/evaluate.ts';

const routeUrl = new URL('../../server/routes/proposals/[id]/evaluate.ts', import.meta.url);
const createFlowUrl = new URL('../../src/pages/CreateProposalWithDrafts.jsx', import.meta.url);

test('active standard proposal evaluations cannot invoke the legacy V1 proposal evaluator', async () => {
  const source = await readFile(routeUrl, 'utf8');

  assert.doesNotMatch(source, /\bevaluateProposalWithVertex\s*\(/);
  assert.match(source, /analysisStage:\s*STAGE1_SHARED_INTAKE_STAGE/);
  assert.match(source, /evaluationSource\s*=\s*'proposal_stage1_intake'/);
  assert.match(source, /evaluator_family:\s*STAGE1_SHARED_INTAKE_STAGE/);
  assert.match(source, /evaluator_version:\s*'v2'/);
  assert.match(source, /evaluation_architecture:\s*'vertex_evaluation_v2'/);
});

test('older Create Opportunity flow truthfully presents the migrated action as Initial Review', async () => {
  const source = await readFile(createFlowUrl, 'utf8');

  assert.match(source, />Initial Review</);
  assert.match(source, /Run Initial Review/);
  assert.match(source, /Running Initial Review\.\.\./);
  assert.doesNotMatch(source, /Run Profile Evaluation|Run Evaluation|run the AI evaluation/);
});

test('proposal Stage 1 input keeps private responses separate and labels proposer observations accurately', () => {
  const input = buildProposalStage1Texts({
    proposal: { title: 'Channel partnership' },
    proposalInput: {
      templateName: 'Partnership',
      responses: [
        {
          label: 'Pilot structure',
          party: 'a',
          value: 'Six-month non-exclusive pilot',
          visibility: 'full',
        },
        {
          label: 'Expected counterparty capacity',
          party: 'b',
          value: 'Can support two implementations',
          visibility: 'full',
        },
        {
          label: 'Internal commission ceiling',
          party: 'a',
          value: 'CONFIDENTIAL_LIMIT_CANARY',
          visibility: 'hidden',
        },
        {
          label: 'Target investment range',
          party: 'a',
          value: null,
          rangeMin: '100000',
          rangeMax: '250000',
          visibility: 'full',
        },
        {
          label: 'Unanswered optional field',
          party: 'a',
          value: null,
          rangeMin: null,
          rangeMax: null,
          visibility: 'full',
        },
      ],
    },
    supplementaryContext: 'Private uploaded-document summary.',
  });

  assert.match(input.sharedText, /one-sided submission/i);
  assert.match(input.sharedText, /proposer observations, not counterparty submissions/i);
  assert.match(input.sharedText, /Counterparty-related observation supplied by the submitting party/i);
  assert.match(input.sharedText, /minimum 100000, maximum 250000/i);
  assert.doesNotMatch(input.sharedText, /Unanswered optional field|\{"min":null,"max":null\}/);
  assert.doesNotMatch(input.sharedText, /CONFIDENTIAL_LIMIT_CANARY/);
  assert.match(input.confidentialText, /CONFIDENTIAL_LIMIT_CANARY/);
  assert.match(input.confidentialText, /Private uploaded-document summary/);
  assert.equal(input.sharedResponseCount, 3);
  assert.equal(input.confidentialResponseCount, 1);
  assert.deepEqual(input.sourceProvenance, {
    shared_source_types: ['template_responses'],
    confidential_source_types: ['template_responses', 'uploaded_document_context'],
    shared_response_count: 3,
    confidential_response_count: 1,
    uploaded_document_context_present: true,
    proposer_observation_count: 1,
    actual_recipient_submission_count: 0,
    empty_response_count: 1,
    range_response_count: 1,
  });
});
