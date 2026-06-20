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

function setCompanyWebsiteExtractHook(fn) {
  const previous = globalThis.__PREMARKET_TEST_COMPANY_CONTEXT_WEBSITE_EXTRACT__;
  globalThis.__PREMARKET_TEST_COMPANY_CONTEXT_WEBSITE_EXTRACT__ = fn;
  return () => {
    if (previous === undefined) delete globalThis.__PREMARKET_TEST_COMPANY_CONTEXT_WEBSITE_EXTRACT__;
    else globalThis.__PREMARKET_TEST_COMPANY_CONTEXT_WEBSITE_EXTRACT__ = previous;
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
    assert.match(calls[0].prompt, /Default product job: answer the custom prompt in a way that helps the user shape the next opportunity, proposal, counterproposal, reply, or negotiation message/);
    assert.match(calls[0].prompt, /Be practical and next-step oriented/);
    assert.match(calls[0].prompt, /Distinguish known facts from assumptions/);
    assert.match(calls[0].prompt, /Avoid generic business advice/);
    assert.match(calls[0].prompt, /Company research safeguard/);
  } finally {
    restoreHook();
    restoreProvider();
    restoreStep2Model();
  }
});

test('Step 2 custom prompts warn against company research without company fields', async () => {
  const calls = [];
  const restoreHook = setOpenAICoachHook(async (params) => {
    calls.push(params);
    return {
      provider: 'openai',
      model: params.preferredModel,
      text: 'Company details are needed before providing company background.',
    };
  });

  try {
    const result = await generateDocumentComparisonCoach({
      ...baseCoachInput('custom_prompt'),
      companyName: '',
      companyWebsite: '',
      promptText: 'Research the counterparty company and summarize their background.',
    });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].purpose, 'coach_custom');
    assert.match(calls[0].prompt, /Company name: unknown/);
    assert.match(calls[0].prompt, /Website: unknown/);
    assert.match(calls[0].prompt, /if the user asks for company research, company background, company context, or counterparty research and no company name or website is provided, do not hallucinate company facts/i);
    assert.match(calls[0].prompt, /ask the user to provide a company name or website/i);
    assert.match(result.result.custom_feedback, /Company details are needed/);
  } finally {
    restoreHook();
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

test('Company Context rejects empty company fields before calling OpenAI', async () => {
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
    await assert.rejects(
      () =>
        generateDocumentComparisonCoach({
          ...baseCoachInput('company_context'),
          companyName: '',
          companyWebsite: '',
        }),
      (error) => {
        assert.equal(error?.code, 'missing_company_context');
        assert.equal(error?.statusCode, 400);
        assert.match(String(error?.message || ''), /Add a company name or website/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  } finally {
    restoreHook();
  }
});

test('Company Context can run with company name only and marks context as limited', async () => {
  const calls = [];
  const restoreHook = setOpenAICoachHook(async (params) => {
    calls.push(params);
    return {
      provider: 'openai',
      model: params.preferredModel,
      text: coachJson({
        summary: {
          overall:
            '## Company Context\n\n### What we know from the provided company details\nCompany context is limited because only the company name was provided. Add a website for a more specific brief.\n\n### Relevance to this negotiation\nUse this as limited counterparty context.\n\n### Missing information / what to verify\nVerify the website and public facts.',
          top_priorities: ['Add website'],
        },
      }),
    };
  });

  try {
    const result = await generateDocumentComparisonCoach({
      ...baseCoachInput('company_context'),
      companyName: 'Acme Finance',
      companyWebsite: '',
    });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /Input basis: company name only/);
    assert.match(calls[0].prompt, /Company context is limited because only the company name was provided/);
    assert.match(result.result.summary.overall, /Company context is limited/);
  } finally {
    restoreHook();
  }
});

test('Company Context can run with website only and passes website as primary input', async () => {
  const calls = [];
  const websiteExtractCalls = [];
  const restoreWebsiteExtract = setCompanyWebsiteExtractHook(async (params) => {
    websiteExtractCalls.push(params);
    return {
      normalizedWebsite: params.normalizedWebsite,
      title: 'Acme Finance - FP&A Automation',
      extractedText: 'Acme Finance helps finance teams automate monthly reporting and variance analysis.',
      fetched: true,
    };
  });
  const restoreHook = setOpenAICoachHook(async (params) => {
    calls.push(params);
    return {
      provider: 'openai',
      model: params.preferredModel,
      text: coachJson({
        summary: {
          overall:
            '## Company Context\n\n### What we know from the provided company details\nWebsite excerpt fetched from https://acme.example.\n\n### Relevance to this negotiation\nUse the excerpt as primary company context.\n\n### Missing information / what to verify\nVerify public facts before relying on them.',
          top_priorities: ['Verify company facts'],
        },
      }),
    };
  });

  try {
    const result = await generateDocumentComparisonCoach({
      ...baseCoachInput('company_context'),
      companyName: '',
      companyWebsite: 'https://acme.example',
    });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(calls.length, 1);
    assert.equal(websiteExtractCalls.length, 1);
    assert.match(calls[0].prompt, /Input basis: website only/);
    assert.match(calls[0].prompt, /Website: https:\/\/acme\.example/);
    assert.match(calls[0].prompt, /Website provided; treat this URL as the primary company-context input/);
    assert.match(calls[0].prompt, /Fetched website URL: https:\/\/acme\.example/);
    assert.match(calls[0].prompt, /Fetched page title: Acme Finance - FP&A Automation/);
    assert.match(calls[0].prompt, /Acme Finance helps finance teams automate monthly reporting/);
    assert.match(result.result.summary.overall, /Website excerpt fetched from https:\/\/acme\.example/);
  } finally {
    restoreHook();
    restoreWebsiteExtract();
  }
});

test('Other Step 2 suggested prompts still run without company fields', async () => {
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
    for (const intent of ['draft_response', 'negotiate', 'risks', 'clarifying_questions']) {
      const result = await generateDocumentComparisonCoach({
        ...baseCoachInput(intent),
        companyName: '',
        companyWebsite: '',
      });
      assert.equal(result.provider, 'openai');
      assert.equal(result.model, 'gpt-5.4');
    }

    assert.equal(calls.length, 4);
    assert.deepEqual(
      calls.map((call) => /Intent: ([a-z_]+)/.exec(call.prompt)?.[1]),
      ['draft_response', 'negotiate', 'risks', 'clarifying_questions'],
    );
  } finally {
    restoreHook();
  }
});
