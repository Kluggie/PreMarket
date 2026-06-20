import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoachPrompt } from '../../server/_lib/vertex-coach.ts';

const BASE_PROMPT_PARAMS = {
  title: 'Prompt Template Verification',
  docAText: 'Confidential strategy terms and fallback price bands.',
  docBText: 'Shared scope, delivery milestones, and payment checkpoints.',
  mode: 'full',
  selectionText: '',
  selectionTarget: 'shared',
  companyName: 'Acme Dynamics',
  companyWebsite: 'https://acme.example.com',
};

test('negotiate prompt includes consultant constraints and required sections', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    intent: 'negotiate',
  });

  assert.match(
    prompt,
    /You are a senior deal consultant\. Provide actionable feedback\. Do not invent facts\. Use only the provided text\./,
  );
  assert.match(prompt, /Do NOT rewrite clauses unless explicitly asked\./);
  assert.match(prompt, /## Objectives/);
  assert.match(prompt, /## Leverage & constraints/);
  assert.match(prompt, /## Proposed negotiation plan \(phased\)/);
  assert.match(prompt, /## Key asks \/ give-gets/);
  assert.match(prompt, /## Suggested framing/);
  assert.match(prompt, /## Next-step checklist/);
  // Sentinel-based delimiters (not XML tags, which are collision-vulnerable)
  assert.ok((prompt.match(/<<<PREMARKET_RAW_/g) || []).length >= 2, 'Prompt must use at least 2 sentinel delimiters for doc content');
  assert.ok(!prompt.includes('<CONFIDENTIAL_TEXT>'), 'Must NOT use vulnerable CONFIDENTIAL_TEXT XML tag');
  assert.ok(!prompt.includes('<SHARED_TEXT>'), 'Must NOT use vulnerable SHARED_TEXT XML tag');
  assert.match(prompt, /Company Context:/);
  assert.match(prompt, /Company name: Acme Dynamics/);
  assert.match(prompt, /Website: https:\/\/acme\.example\.com/);
  assert.doesNotMatch(prompt, /Website Evidence:/);
});

test('risks prompt includes ranked-risk structure and mitigation framing', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    intent: 'risks',
  });

  assert.match(prompt, /Do NOT rewrite clauses unless explicitly asked\./);
  assert.match(prompt, /## Material risks \(ranked High\/Med\/Low\)/);
  assert.match(prompt, /## Ambiguities \/ missing info/);
  assert.match(prompt, /## Red flags \/ inconsistencies/);
  assert.match(prompt, /## Suggested mitigations \(contract\/process\)/);
  assert.match(prompt, /## Deal-breakers vs negotiables/);
  assert.match(prompt, /Risk level: High/);
  assert.match(prompt, /Risk level: Medium/);
  assert.match(prompt, /Risk level: Low/);
});

test('draft_response prompt asks for a sendable response across round types', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    intent: 'draft_response',
  });

  assert.match(prompt, /Help the user draft a practical response to the current shared round/);
  assert.match(prompt, /original proposal, reply, counterproposal, or later negotiation update/);
  assert.match(prompt, /summary\.overall MUST be markdown containing a concise response/);
  assert.match(prompt, /Acknowledge areas of agreement/);
  assert.match(prompt, /Raise unresolved issues without overcommitting/);
});

test('clarifying_questions prompt asks for prioritized questions with reasons', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    intent: 'clarifying_questions',
  });

  assert.match(prompt, /Generate questions the user should ask before responding/);
  assert.match(prompt, /short prioritized list of practical questions/);
  assert.match(prompt, /Each question must include a short note explaining why it matters/);
  assert.match(prompt, /Populate the questions array/);
});

test('company_context prompt forbids hallucinated company facts', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    intent: 'company_context',
  });

  assert.match(prompt, /Help the user understand relevant company or counterparty context/);
  assert.match(prompt, /Website is the primary company-context input when provided/);
  assert.match(prompt, /Use public\/shared text, user-provided confidential text, mediator context, and visible shared history only as secondary negotiation context/);
  assert.match(prompt, /Do not treat proposal wording, negotiation history, or shared workspace context as a substitute for company research/);
  assert.match(prompt, /Do not hallucinate company facts/);
  assert.match(prompt, /If there is not enough company information/);
  assert.match(prompt, /Distinguish known facts from assumptions/);
  assert.match(prompt, /Input basis: website \+ company name/);
  assert.match(prompt, /Website provided; treat this URL as the primary company-context input/);
  assert.match(prompt, /No website page excerpt was available for https:\/\/acme\.example\.com/);
  assert.match(prompt, /do not infer company facts from the website/i);
  assert.match(prompt, /What we know from the provided company details/);
  assert.match(prompt, /Relevance to this negotiation/);
  assert.match(prompt, /Missing information \/ what to verify/);
});

test('company_context prompt includes fetched website evidence when available', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    intent: 'company_context',
    companyWebsiteContext: {
      normalizedWebsite: 'https://acme.example.com',
      title: 'Acme Dynamics - Finance Workflow Platform',
      extractedText: 'Acme Dynamics provides reporting automation for finance teams.',
      fetched: true,
    },
  });

  assert.match(prompt, /Website Evidence:/);
  assert.match(prompt, /Fetched website URL: https:\/\/acme\.example\.com/);
  assert.match(prompt, /Fetched page title: Acme Dynamics - Finance Workflow Platform/);
  assert.match(prompt, /Acme Dynamics provides reporting automation for finance teams/);
});

test('company_context prompt marks company-name-only context as limited', () => {
  const prompt = buildCoachPrompt({
    ...BASE_PROMPT_PARAMS,
    companyWebsite: '',
    intent: 'company_context',
  });

  assert.match(prompt, /Input basis: company name only/);
  assert.match(prompt, /Company context is limited because only the company name was provided/);
  assert.match(prompt, /Add a website for a more specific brief/);
});
