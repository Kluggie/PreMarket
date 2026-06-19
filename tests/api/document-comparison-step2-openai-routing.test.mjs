import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COACH_PROMPT_VERSION,
  generateDocumentComparisonCoach,
  resolveStep2CoachProviderModel,
} from '../../server/_lib/vertex-coach.ts';

function setEnv(name, value) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

function setOpenAICoachHook(fn) {
  const previous = globalThis.__PREMARKET_TEST_OPENAI_COACH_CALL__;
  globalThis.__PREMARKET_TEST_OPENAI_COACH_CALL__ = fn;
  return () => {
    if (previous === undefined) delete globalThis.__PREMARKET_TEST_OPENAI_COACH_CALL__;
    else globalThis.__PREMARKET_TEST_OPENAI_COACH_CALL__ = previous;
  };
}

function coachJson(overrides = {}) {
  return JSON.stringify({
    version: COACH_PROMPT_VERSION,
    summary: {
      overall:
        'Thanks for the latest round. We agree on the direction, but need to clarify scope, acceptance timing, and next steps before confirming.',
      top_priorities: ['Clarify scope', 'Confirm acceptance timing'],
    },
    suggestions: [],
    concerns: [],
    questions: [],
    negotiation_moves: [],
    ...overrides,
  });
}

function baseCoachInput(intent) {
  return {
    title: 'Step 2 Routing',
    docAText: 'User confidential notes: preserve flexibility on support commitments.',
    docBText: 'Shared round: implementation partnership with open scope and referral responsibilities.',
    mode: 'full',
    intent,
    companyName: 'Acme Finance',
    companyWebsite: 'https://acme.example',
  };
}

test('Step 2 suggested prompts default to OpenAI / gpt-5.4', async () => {
  const restoreProvider = setEnv('MEDIATION_STEP2_AI_PROVIDER', undefined);
  const restoreStep2Model = setEnv('MEDIATION_STEP2_AI_MODEL', undefined);
  const restoreMediationModel = setEnv('MEDIATION_AI_MODEL', undefined);
  const calls = [];
  const restoreHook = setOpenAICoachHook(async (params) => {
    calls.push(params);
    return {
      provider: 'openai',
      model: params.preferredModel,
      text: coachJson(),
    };
  });

  try {
    const providerModel = resolveStep2CoachProviderModel();
    assert.deepEqual(providerModel, { provider: 'openai', model: 'gpt-5.4' });

    const result = await generateDocumentComparisonCoach(baseCoachInput('draft_response'));
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].preferredModel, 'gpt-5.4');
    assert.equal(calls[0].responseFormat, 'json');
    assert.equal(calls[0].purpose, 'coach_structured');
    assert.match(calls[0].prompt, /Intent: draft_response/);
  } finally {
    restoreHook();
    restoreProvider();
    restoreStep2Model();
    restoreMediationModel();
  }
});

test('Step 2 custom prompts use the same OpenAI / gpt-5.4 route', async () => {
  const restoreProvider = setEnv('MEDIATION_STEP2_AI_PROVIDER', 'openai');
  const restoreStep2Model = setEnv('MEDIATION_STEP2_AI_MODEL', 'gpt-5.4');
  const calls = [];
  const restoreHook = setOpenAICoachHook(async (params) => {
    calls.push(params);
    return {
      provider: 'openai',
      model: params.preferredModel,
      text: 'Custom prompt feedback grounded in the shared round.',
    };
  });

  try {
    const result = await generateDocumentComparisonCoach({
      ...baseCoachInput('custom_prompt'),
      promptText: 'Draft a counterproposal and list risks.',
    });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(result.result.custom_feedback, 'Custom prompt feedback grounded in the shared round.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].preferredModel, 'gpt-5.4');
    assert.equal(calls[0].responseFormat, 'text');
    assert.equal(calls[0].purpose, 'coach_custom');
  } finally {
    restoreHook();
    restoreProvider();
    restoreStep2Model();
  }
});

test('Step 2 supports a specific model override without using Vertex/Gemini', async () => {
  const restoreStep2Model = setEnv('MEDIATION_STEP2_AI_MODEL', 'gpt-5.4');
  const restoreVertexMock = setEnv('VERTEX_MOCK', undefined);
  const calls = [];
  const restoreHook = setOpenAICoachHook(async (params) => {
    calls.push(params);
    return {
      provider: 'openai',
      model: params.preferredModel,
      text: coachJson({
        concerns: [
          {
            id: 'risk_gap',
            severity: 'warning',
            title: 'Undefined implementation ownership',
            details: 'The shared round does not define who owns handoffs.',
          },
        ],
      }),
    };
  });

  try {
    const result = await generateDocumentComparisonCoach(baseCoachInput('risks'));
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].preferredModel, 'gpt-5.4');
    assert.equal(result.result.concerns.some((concern) => concern.id === 'risk_gap'), true);
  } finally {
    restoreHook();
    restoreStep2Model();
    restoreVertexMock();
  }
});
