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
  assert.match(prompt, /<CONFIDENTIAL_TEXT>/);
  assert.match(prompt, /<SHARED_TEXT>/);
  assert.match(prompt, /Company Context:/);
  assert.match(prompt, /Company name: Acme Dynamics/);
  assert.match(prompt, /Website: https:\/\/acme\.example\.com/);
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
