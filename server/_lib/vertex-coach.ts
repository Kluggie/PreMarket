import { createHash, createSign } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { getVertexConfig } from './integrations.js';

export const COACH_PROMPT_VERSION = 'coach-v1';

export type CoachMode = 'full' | 'shared_only' | 'selection';
export type CoachIntent = 'improve' | 'negotiate' | 'risks' | 'rewrite';
export type CoachSelectionTarget = 'confidential' | 'shared';

const SuggestionSchema = z
  .object({
    id: z.string().min(1),
    scope: z.enum(['confidential', 'shared']),
    severity: z.enum(['info', 'warning', 'critical']),
    title: z.string().min(1),
    rationale: z.string().min(1),
    proposed_change: z.object({
      target: z.enum(['doc_a', 'doc_b']),
      op: z.enum(['replace_selection', 'append', 'insert_after_heading', 'replace_section']),
      heading_hint: z.string().trim().min(1).optional(),
      text: z.string().min(1),
    }),
    evidence: z.object({
      shared_quotes: z.array(z.string()).default([]),
      confidential_quotes: z.array(z.string()).default([]),
    }),
  })
  .strict();

const ConcernSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['warning', 'critical']),
    title: z.string().min(1),
    details: z.string().min(1),
  })
  .strict();

const QuestionSchema = z
  .object({
    id: z.string().min(1),
    to: z.enum(['counterparty', 'self']),
    text: z.string().min(1),
    why: z.string().min(1),
  })
  .strict();

const NegotiationMoveSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    move: z.string().min(1),
    tradeoff: z.string().min(1),
  })
  .strict();

const CoachEnvelopeSchema = z
  .object({
    version: z.literal(COACH_PROMPT_VERSION),
    summary: z
      .object({
        overall: z.string().min(1),
        top_priorities: z.array(z.string()).default([]),
      })
      .strict(),
    suggestions: z.array(z.unknown()).default([]),
    concerns: z.array(z.unknown()).default([]),
    questions: z.array(z.unknown()).default([]),
    negotiation_moves: z.array(z.unknown()).default([]),
  })
  .strict();

export type CoachSuggestion = z.infer<typeof SuggestionSchema>;
export type CoachConcern = z.infer<typeof ConcernSchema>;
export type CoachQuestion = z.infer<typeof QuestionSchema>;
export type CoachNegotiationMove = z.infer<typeof NegotiationMoveSchema>;

export type CoachResultV1 = {
  version: typeof COACH_PROMPT_VERSION;
  summary: {
    overall: string;
    top_priorities: string[];
  };
  suggestions: CoachSuggestion[];
  concerns: CoachConcern[];
  questions: CoachQuestion[];
  negotiation_moves: CoachNegotiationMove[];
};

type GenerateCoachParams = {
  title: string;
  docAText: string;
  docBText: string;
  mode: CoachMode;
  intent: CoachIntent;
  selectionText?: string;
  selectionTarget?: CoachSelectionTarget;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function invalidModelOutput(message: string, extra: Record<string, unknown> = {}) {
  return new ApiError(502, 'invalid_model_output', message, extra);
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

async function fetchGoogleAccessToken(credentials: {
  client_email: string;
  private_key: string;
  token_uri: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64url');
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, 'vertex_auth_failed', 'Unable to authenticate with Vertex AI');
  }

  const payloadJson = (await response.json().catch(() => ({}))) as { access_token?: string };
  const accessToken = asText(payloadJson.access_token);
  if (!accessToken) {
    throw new ApiError(502, 'vertex_auth_failed', 'Vertex AI access token was not returned');
  }
  return accessToken;
}

function extractModelText(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = Array.isArray(candidates?.[0]?.content?.parts) ? candidates[0].content.parts : [];
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter((text) => text.length > 0)
    .join('\n')
    .trim();
}

function parseModelJson(text: string) {
  const raw = String(text || '').trim();
  if (!raw) {
    return null;
  }

  const candidates = [
    raw,
    raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim(),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Continue to fallback extraction.
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = raw.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(sliced);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function buildCoachPrompt(params: GenerateCoachParams) {
  const mode = params.mode;
  const intent = params.intent;
  const selectionTarget = params.selectionTarget || 'shared';
  const selectionText = asText(params.selectionText);
  const selectionSection =
    mode === 'selection'
      ? `Selection Target: ${selectionTarget}\nSelection Text:\n${selectionText || '(none provided)'}`
      : 'Selection Target: n/a\nSelection Text: n/a';

  return [
    'You are an AI negotiation coach for a document comparison workflow.',
    'Return ONLY valid JSON. Do not return markdown.',
    `JSON schema version MUST be "${COACH_PROMPT_VERSION}".`,
    'Output schema:',
    JSON.stringify(
      {
        version: COACH_PROMPT_VERSION,
        summary: { overall: 'string', top_priorities: ['string'] },
        suggestions: [
          {
            id: 'string',
            scope: 'confidential|shared',
            severity: 'info|warning|critical',
            title: 'string',
            rationale: 'string',
            proposed_change: {
              target: 'doc_a|doc_b',
              op: 'replace_selection|append|insert_after_heading|replace_section',
              heading_hint: 'string?',
              text: 'string',
            },
            evidence: {
              shared_quotes: ['string'],
              confidential_quotes: ['string'],
            },
          },
        ],
        concerns: [{ id: 'string', severity: 'warning|critical', title: 'string', details: 'string' }],
        questions: [{ id: 'string', to: 'counterparty|self', text: 'string', why: 'string' }],
        negotiation_moves: [{ id: 'string', title: 'string', move: 'string', tradeoff: 'string' }],
      },
      null,
      2,
    ),
    '',
    'Security rules (non-negotiable):',
    '1) You may read BOTH documents (doc_a confidential + doc_b shared) to coach the OWNER.',
    '2) For any suggestion targeting doc_b or scope=shared:',
    '   - Do NOT introduce facts/numbers/names/details that are only in doc_a.',
    '   - Keep evidence.shared_quotes to exact snippets from doc_b only.',
    '   - evidence.confidential_quotes MUST be [] for shared suggestions.',
    '   - If confidential context helps, convert to a generic recommendation without revealing details.',
    '3) For confidential suggestions (target doc_a/scope=confidential), confidential references are allowed.',
    '4) Provide concise, actionable suggestions.',
    '',
    `Mode: ${mode}`,
    `Intent: ${intent}`,
    selectionSection,
    '',
    `Title: ${params.title || 'Untitled Comparison'}`,
    '',
    'Confidential Document (doc_a):',
    params.docAText || '(empty)',
    '',
    'Shared Document (doc_b):',
    params.docBText || '(empty)',
  ].join('\n');
}

function buildCoachCorrectionPrompt(basePrompt: string, invalidOutput: string) {
  return [
    basePrompt,
    '',
    'Your previous response was invalid JSON. Return valid JSON ONLY and follow the exact schema.',
    'Invalid response excerpt:',
    invalidOutput.slice(0, 1600),
  ].join('\n');
}

async function callVertexCoach(prompt: string, preferredModel = '') {
  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    throw new ApiError(501, 'not_configured', 'Vertex AI integration is not configured');
  }

  const accessToken = await fetchGoogleAccessToken(vertex.credentials);
  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location;
  const preferred =
    asText(preferredModel) || asText(process.env.VERTEX_COACH_MODEL) || asText(process.env.VERTEX_MODEL) || vertex.model;
  const modelCandidates = [preferred, 'gemini-2.0-flash-001', 'gemini-1.5-flash-002', 'gemini-1.5-flash-001']
    .map((value) => asText(value))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  let lastStatus = 0;
  let lastMessage = '';

  for (const model of modelCandidates) {
    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 5000,
          temperature: 0.2,
          topP: 0.9,
        },
      }),
    });

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      return {
        provider: 'vertex' as const,
        model,
        text: extractModelText(payload),
      };
    }

    const details = await response.text().catch(() => '');
    lastStatus = response.status;
    lastMessage = details ? details.slice(0, 500) : '';
    const modelMissing = response.status === 404 && /publisher model/i.test(details);
    if (modelMissing) {
      continue;
    }

    throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
      upstreamStatus: response.status,
      upstreamMessage: lastMessage || null,
      triedModels: modelCandidates,
    });
  }

  throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
    upstreamStatus: lastStatus || 404,
    upstreamMessage: lastMessage || 'No accessible Vertex model found for this project',
    triedModels: modelCandidates,
  });
}

export function validateCoachResultV1(raw: unknown): CoachResultV1 {
  const envelope = CoachEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw invalidModelOutput('Coach result did not match CoachResultV1 envelope', {
      issues: envelope.error.issues,
    });
  }

  const suggestions = envelope.data.suggestions
    .map((entry) => SuggestionSchema.safeParse(entry))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .filter((suggestion) => {
      if (suggestion.scope === 'shared' && suggestion.proposed_change.target !== 'doc_b') {
        return false;
      }
      if (suggestion.scope === 'confidential' && suggestion.proposed_change.target !== 'doc_a') {
        return false;
      }
      return true;
    });

  const concerns = envelope.data.concerns
    .map((entry) => ConcernSchema.safeParse(entry))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  const questions = envelope.data.questions
    .map((entry) => QuestionSchema.safeParse(entry))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  const negotiationMoves = envelope.data.negotiation_moves
    .map((entry) => NegotiationMoveSchema.safeParse(entry))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  return {
    version: COACH_PROMPT_VERSION,
    summary: {
      overall: envelope.data.summary.overall.trim(),
      top_priorities: envelope.data.summary.top_priorities
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    },
    suggestions,
    concerns,
    questions,
    negotiation_moves: negotiationMoves,
  };
}

function normalizeForMatch(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpaces(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

type LeakProfile = {
  confidentialWordPhrases: string[];
  confidentialLongSnippets: string[];
  confidentialCharChunks: string[];
  sharedRawText: string;
};

function buildLeakProfile(confidentialText: string, sharedText: string): LeakProfile {
  const normalizedConfidential = normalizeForMatch(confidentialText);
  const normalizedShared = normalizeForMatch(sharedText);
  const words = normalizedConfidential.split(' ').filter(Boolean);

  const confidentialWordPhrases: string[] = [];
  if (words.length >= 8) {
    const maxPhrases = 320;
    const step = Math.max(1, Math.floor((words.length - 7) / maxPhrases));
    for (let index = 0; index <= words.length - 8 && confidentialWordPhrases.length < maxPhrases; index += step) {
      const phrase = words.slice(index, index + 8).join(' ').trim();
      if (phrase.length < 28) {
        continue;
      }
      if (!normalizedShared.includes(phrase) && !confidentialWordPhrases.includes(phrase)) {
        confidentialWordPhrases.push(phrase);
      }
    }
  }

  const confidentialLongSnippets: string[] = [];
  const sharedLower = normalizeSpaces(sharedText);
  const normalizedConfidentialRaw = normalizeSpaces(confidentialText);
  const segments = String(confidentialText || '')
    .split(/[\n\r]+|(?<=[.!?;:])\s+/g)
    .map((segment) => normalizeSpaces(segment))
    .filter((segment) => segment.length >= 25);
  for (const segment of segments) {
    if (confidentialLongSnippets.length >= 240) {
      break;
    }
    if (sharedLower.includes(segment)) {
      continue;
    }
    if (!confidentialLongSnippets.includes(segment)) {
      confidentialLongSnippets.push(segment);
    }
  }

  const confidentialCharChunks: string[] = [];
  if (normalizedConfidentialRaw.length >= 25) {
    const chunkLength = 32;
    const maxChunks = 260;
    const maxStart = normalizedConfidentialRaw.length - 25;
    const step = Math.max(6, Math.floor(maxStart / maxChunks));
    for (let index = 0; index <= maxStart && confidentialCharChunks.length < maxChunks; index += step) {
      const chunk = normalizedConfidentialRaw.slice(index, index + chunkLength).trim();
      if (chunk.length < 25) {
        continue;
      }
      if (sharedLower.includes(chunk)) {
        continue;
      }
      if (!confidentialCharChunks.includes(chunk)) {
        confidentialCharChunks.push(chunk);
      }
    }
  }

  return {
    confidentialWordPhrases,
    confidentialLongSnippets,
    confidentialCharChunks,
    sharedRawText: String(sharedText || ''),
  };
}

function hasConfidentialLeakInSharedSuggestion(changeText: string, leakProfile: LeakProfile) {
  const normalizedChange = normalizeForMatch(changeText);
  const lowerChange = normalizeSpaces(changeText);
  if (!normalizedChange || !lowerChange) {
    return false;
  }

  if (leakProfile.confidentialWordPhrases.some((phrase) => normalizedChange.includes(phrase))) {
    return true;
  }

  if (leakProfile.confidentialLongSnippets.some((snippet) => lowerChange.includes(snippet))) {
    return true;
  }

  if (leakProfile.confidentialCharChunks.some((chunk) => lowerChange.includes(chunk))) {
    return true;
  }

  return false;
}

export function applyCoachLeakGuard(params: {
  coachResult: CoachResultV1;
  confidentialText: string;
  sharedText: string;
}) {
  const sharedText = String(params.sharedText || '');
  const leakProfile = buildLeakProfile(params.confidentialText, sharedText);
  const safeSuggestions: CoachSuggestion[] = [];
  const concerns = [...(Array.isArray(params.coachResult.concerns) ? params.coachResult.concerns : [])];
  let withheldCount = 0;

  for (const suggestion of params.coachResult.suggestions || []) {
    const isSharedTarget =
      suggestion?.scope === 'shared' || suggestion?.proposed_change?.target === 'doc_b';
    if (!isSharedTarget) {
      safeSuggestions.push(suggestion);
      continue;
    }

    const sharedQuotes = Array.isArray(suggestion?.evidence?.shared_quotes)
      ? suggestion.evidence.shared_quotes.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const confidentialQuotes = Array.isArray(suggestion?.evidence?.confidential_quotes)
      ? suggestion.evidence.confidential_quotes.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const hasInvalidQuote = sharedQuotes.some((quote) => !sharedText.includes(quote));
    const hasConfidentialQuotes = confidentialQuotes.length > 0;
    const hasLeak = hasConfidentialLeakInSharedSuggestion(
      String(suggestion?.proposed_change?.text || ''),
      leakProfile,
    );

    if (hasInvalidQuote || hasConfidentialQuotes || hasLeak) {
      withheldCount += 1;
      concerns.push({
        id: `withheld_${suggestion.id || withheldCount}`,
        severity: 'warning',
        title: 'Withheld shared suggestion for confidentiality safety',
        details: 'A shared-side suggestion was removed because it risked exposing confidential information.',
      });
      continue;
    }

    safeSuggestions.push({
      ...suggestion,
      scope: 'shared',
      proposed_change: {
        ...suggestion.proposed_change,
        target: 'doc_b',
      },
      evidence: {
        shared_quotes: sharedQuotes,
        confidential_quotes: [],
      },
    });
  }

  return {
    coachResult: {
      ...params.coachResult,
      suggestions: safeSuggestions,
      concerns,
    } as CoachResultV1,
    withheldCount,
  };
}

function buildMockCoachResult(params: GenerateCoachParams): CoachResultV1 {
  const sharedPreview = asText(params.docBText).slice(0, 180) || 'shared document content';
  const confidentialPreview = asText(params.docAText).slice(0, 180) || 'confidential document content';
  const selectionText = asText(params.selectionText);
  const selectionTarget = params.selectionTarget === 'confidential' ? 'doc_a' : 'doc_b';
  const sharedQuote = sharedPreview.length > 20 ? sharedPreview.slice(0, Math.min(sharedPreview.length, 90)) : '';

  const selectionSuggestion: CoachSuggestion = {
    id: 'suggestion_selection_rewrite',
    scope: selectionTarget === 'doc_a' ? 'confidential' : 'shared',
    severity: 'info',
    title: 'Rewrite the selected text for clarity',
    rationale: 'This revision simplifies sentence structure and keeps the intent explicit.',
    proposed_change: {
      target: selectionTarget,
      op: 'replace_selection',
      text: selectionText
        ? `Rewritten: ${selectionText}`
        : `Add a concise and specific rewrite for this ${selectionTarget === 'doc_a' ? 'confidential' : 'shared'} section.`,
    },
    evidence: {
      shared_quotes: selectionTarget === 'doc_b' && sharedQuote ? [sharedQuote] : [],
      confidential_quotes: selectionTarget === 'doc_a' ? [confidentialPreview.slice(0, 70)] : [],
    },
  };

  const baseSuggestions: CoachSuggestion[] =
    params.mode === 'selection'
      ? [selectionSuggestion]
      : [
          {
            id: 'suggestion_shared_clarity',
            scope: 'shared',
            severity: 'warning',
            title: 'Clarify obligations in shared language',
            rationale: 'Explicit obligations reduce ambiguity during negotiation.',
            proposed_change: {
              target: 'doc_b',
              op: 'append',
              text: 'Add a short section that clarifies deliverables, acceptance criteria, and timeline ownership.',
            },
            evidence: {
              shared_quotes: sharedQuote ? [sharedQuote] : [],
              confidential_quotes: [],
            },
          },
          {
            id: 'suggestion_confidential_positioning',
            scope: 'confidential',
            severity: 'info',
            title: 'Strengthen internal negotiation fallback',
            rationale: 'A clear fallback improves owner-side negotiation readiness.',
            proposed_change: {
              target: 'doc_a',
              op: 'append',
              text: 'Add internal fallback terms and acceptable concessions before discussing revisions externally.',
            },
            evidence: {
              shared_quotes: [],
              confidential_quotes: confidentialPreview ? [confidentialPreview.slice(0, 90)] : [],
            },
          },
        ];

  return {
    version: COACH_PROMPT_VERSION,
    summary: {
      overall: 'Prioritize clearer shared wording and define negotiation fallback positions.',
      top_priorities: ['Improve shared clarity', 'Prepare negotiation fallback', 'Resolve high-risk ambiguities'],
    },
    suggestions: baseSuggestions,
    concerns: [
      {
        id: 'concern_alignment',
        severity: 'warning',
        title: 'Potential misalignment between scope and commitments',
        details: 'Review whether shared commitments are specific enough for the expected delivery timeline.',
      },
    ],
    questions: [
      {
        id: 'question_counterparty_scope',
        to: 'counterparty',
        text: 'Can you confirm measurable acceptance criteria for each deliverable?',
        why: 'This reduces ambiguity before final approval.',
      },
    ],
    negotiation_moves: [
      {
        id: 'move_trade_scope_for_timeline',
        title: 'Scope-for-timeline trade',
        move: 'Offer phased scope with milestone-based acceptance.',
        tradeoff: 'Improves predictability but may reduce short-term flexibility.',
      },
    ],
  };
}

export function buildCoachCacheHash(params: {
  docAText: string;
  docBText: string;
  model: string;
  mode: CoachMode;
  intent: CoachIntent;
  selectionTarget?: CoachSelectionTarget;
  selectionText?: string;
}) {
  return createHash('sha256')
    .update(
      [
        COACH_PROMPT_VERSION,
        asLower(params.model),
        params.mode,
        params.intent,
        asLower(params.selectionTarget || ''),
        String(params.docAText || ''),
        String(params.docBText || ''),
        String(params.selectionText || ''),
      ].join('\n---\n'),
    )
    .digest('hex');
}

export function buildSelectionTextHash(selectionText: string) {
  const text = String(selectionText || '');
  if (!text) {
    return '';
  }
  return createHash('sha256').update(text).digest('hex');
}

export async function generateDocumentComparisonCoach(params: GenerateCoachParams) {
  const mockPayload = asText(process.env.VERTEX_COACH_MOCK_RESPONSE);
  if (mockPayload) {
    const parsed = parseModelJson(mockPayload);
    if (!parsed) {
      throw invalidModelOutput('VERTEX_COACH_MOCK_RESPONSE is not valid JSON');
    }
    return {
      provider: 'mock' as const,
      model: 'vertex-coach-mock',
      result: validateCoachResultV1(parsed),
    };
  }

  if (String(process.env.VERTEX_MOCK || '').trim() === '1') {
    return {
      provider: 'mock' as const,
      model: 'vertex-coach-mock',
      result: validateCoachResultV1(buildMockCoachResult(params)),
    };
  }

  const basePrompt = buildCoachPrompt(params);
  let latestText = '';
  let latestModel = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? basePrompt : buildCoachCorrectionPrompt(basePrompt, latestText);
    const vertex = await callVertexCoach(prompt, process.env.VERTEX_COACH_MODEL || process.env.VERTEX_MODEL || '');
    latestText = vertex.text;
    latestModel = vertex.model;
    const parsed = parseModelJson(vertex.text);
    if (!parsed) {
      continue;
    }
    return {
      provider: vertex.provider,
      model: vertex.model,
      result: validateCoachResultV1(parsed),
    };
  }

  throw invalidModelOutput('Coach model output was not valid JSON after retry', {
    model: latestModel || 'unknown',
  });
}
