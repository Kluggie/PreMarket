import { createSign } from 'node:crypto';
import { ApiError } from './errors.js';
import { getVertexConfig } from './integrations.js';

type Span = { start: number; end: number; level: string };

type ComparisonInput = {
  title: string;
  partyALabel: string;
  partyBLabel: string;
  docAText: string;
  docBText: string;
  docASpans: Span[];
  docBSpans: Span[];
};

type ComparisonEvaluation = {
  provider: 'vertex' | 'mock';
  model: string;
  generatedAt: string;
  score: number;
  confidence: number;
  recommendation: 'High' | 'Medium' | 'Low';
  summary: string;
  report: {
    generated_at: string;
    title: string;
    recommendation: 'High' | 'Medium' | 'Low';
    similarity_score: number;
    confidence_score: number;
    delta_characters: number;
    confidentiality_spans: number;
    executive_summary: string;
    sections: Array<{ key: string; heading: string; bullets: string[] }>;
    provider: string;
    model: string;
  };
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signJwt(unsignedToken: string, privateKey: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  return signer.sign(privateKey, 'base64url');
}

function clampSpanBoundary(raw: unknown, textLength: number) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(Math.floor(numeric), textLength));
}

function normalizeHighlightLevel(level: unknown) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

function normalizeSpans(spans: unknown, text: string) {
  if (!Array.isArray(spans)) return [];
  const textLength = String(text || '').length;

  const normalized = spans
    .map((span) => {
      const start = clampSpanBoundary(span?.start, textLength);
      const end = clampSpanBoundary(span?.end, textLength);
      const level = normalizeHighlightLevel(span?.level);
      if (start === null || end === null || end <= start || !level) return null;
      return { start, end, level };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  const merged: Array<{ start: number; end: number; level: string }> = [];
  normalized.forEach((span) => {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      return;
    }

    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      return;
    }

    merged.push({ ...span });
  });

  return merged;
}

function maskTextBySpans(text: string, spans: Span[]) {
  if (!text) return '';
  const normalizedSpans = normalizeSpans(spans || [], text);
  if (!normalizedSpans.length) return text;

  let cursor = 0;
  let hiddenIndex = 1;
  const parts: string[] = [];

  normalizedSpans.forEach((span) => {
    if (span.start > cursor) {
      parts.push(text.slice(cursor, span.start));
    }
    parts.push(`[HIDDEN_${hiddenIndex}]`);
    hiddenIndex += 1;
    cursor = span.end;
  });

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.join('');
}

function collectHiddenSnippets(text: string, spans: Span[]) {
  const normalized = normalizeSpans(spans || [], text);
  return normalized
    .map((span) => text.slice(span.start, span.end))
    .map((snippet) => snippet.trim())
    .filter((snippet) => snippet.length >= 4)
    .slice(0, 50);
}

function tokenize(input: string) {
  return new Set(
    String(input || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((entry) => entry.length >= 3),
  );
}

function computeSimilarity(docAText: string, docBText: string) {
  const tokensA = tokenize(docAText);
  const tokensB = tokenize(docBText);
  const intersection = new Set([...tokensA].filter((token) => tokensB.has(token)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  return Math.round((intersection.size / union.size) * 100);
}

function toRecommendation(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 80) return 'High';
  if (score >= 55) return 'Medium';
  return 'Low';
}

function sanitizeTextAgainstHiddenSnippets(text: string, snippets: string[]) {
  if (!asText(text) || !Array.isArray(snippets) || snippets.length === 0) {
    return String(text || '');
  }

  let output = String(text || '');
  snippets.forEach((snippet) => {
    if (!snippet) return;
    output = output.split(snippet).join('[REDACTED]');
  });

  return output;
}

function sanitizeBullets(bullets: unknown, snippets: string[]) {
  if (!Array.isArray(bullets)) return [];
  return bullets
    .map((bullet) => sanitizeTextAgainstHiddenSnippets(String(bullet || ''), snippets))
    .filter((bullet) => bullet.length > 0)
    .slice(0, 8);
}

function buildMockComparisonEvaluation(input: ComparisonInput): ComparisonEvaluation {
  const docAText = String(input.docAText || '');
  const docBText = String(input.docBText || '');
  const score = computeSimilarity(docAText, docBText);
  const recommendation = toRecommendation(score);
  const confidence = Math.min(99, Math.max(1, Math.round(score * 0.9)));
  const generatedAt = new Date().toISOString();
  const deltaCharacters = Math.abs(docAText.length - docBText.length);
  const confidentialitySpans = (input.docASpans?.length || 0) + (input.docBSpans?.length || 0);
  const summary =
    `Comparison score ${score}/100 with ${confidence}% confidence. ` +
    `Recommendation: ${recommendation}. Hidden spans respected: ${confidentialitySpans}.`;

  return {
    provider: 'mock',
    model: 'vertex-mock',
    generatedAt,
    score,
    confidence,
    recommendation,
    summary,
    report: {
      generated_at: generatedAt,
      title: input.title,
      recommendation,
      similarity_score: score,
      confidence_score: confidence,
      delta_characters: deltaCharacters,
      confidentiality_spans: confidentialitySpans,
      executive_summary: summary,
      sections: [
        {
          key: 'summary',
          heading: 'Comparison Summary',
          bullets: [
            `${input.partyALabel} length: ${docAText.length} characters`,
            `${input.partyBLabel} length: ${docBText.length} characters`,
            `Similarity score: ${score}`,
          ],
        },
        {
          key: 'confidentiality',
          heading: 'Confidentiality Handling',
          bullets: [
            `Hidden spans total: ${confidentialitySpans}`,
            `${input.partyALabel} hidden spans: ${input.docASpans.length}`,
            `${input.partyBLabel} hidden spans: ${input.docBSpans.length}`,
          ],
        },
      ],
      provider: 'mock',
      model: 'vertex-mock',
    },
  };
}

async function fetchGoogleAccessToken(credentials: {
  client_email: string;
  private_key: string;
  token_uri: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const jwtPayload = base64UrlEncode(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      exp: now + 60 * 60,
      iat: now,
    }),
  );
  const unsignedToken = `${jwtHeader}.${jwtPayload}`;
  const signedToken = `${unsignedToken}.${signJwt(unsignedToken, credentials.private_key)}`;

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedToken,
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, 'vertex_auth_failed', 'Unable to authenticate with Vertex AI');
  }

  const payload = (await response.json().catch(() => ({}))) as { access_token?: string };
  const accessToken = asText(payload?.access_token);
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
  if (!raw) return null;

  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function buildPrompt(input: ComparisonInput) {
  const docAText = String(input.docAText || '');
  const docBText = String(input.docBText || '');
  const docASpans = normalizeSpans(input.docASpans || [], docAText);
  const docBSpans = normalizeSpans(input.docBSpans || [], docBText);
  const maskedA = maskTextBySpans(docAText, docASpans);
  const maskedB = maskTextBySpans(docBText, docBSpans);
  const maxDocChars = 12000;

  return [
    'You are an enterprise document-comparison analyst.',
    'Confidentiality rules:',
    '- Hidden spans are confidential and MUST NOT be quoted verbatim in output.',
    '- You may reason using full documents, but output must use paraphrased insights only for hidden content.',
    '- Return JSON only. Do not include markdown fences.',
    'Output schema:',
    JSON.stringify(
      {
        recommendation: 'High|Medium|Low',
        score: 0,
        confidence: 0,
        summary: 'string',
        sections: [{ heading: 'string', bullets: ['string'] }],
      },
      null,
      2,
    ),
    'Input context:',
    JSON.stringify(
      {
        title: input.title,
        party_a_label: input.partyALabel,
        party_b_label: input.partyBLabel,
        doc_a_hidden_spans: docASpans,
        doc_b_hidden_spans: docBSpans,
        doc_a_masked: maskedA.slice(0, maxDocChars),
        doc_b_masked: maskedB.slice(0, maxDocChars),
        doc_a_full: docAText.slice(0, maxDocChars),
        doc_b_full: docBText.slice(0, maxDocChars),
      },
      null,
      2,
    ),
  ].join('\n');
}

function sanitizeEvaluation(candidate: any, rawText: string, input: ComparisonInput): ComparisonEvaluation {
  const generatedAt = new Date().toISOString();
  const hiddenSnippets = [
    ...collectHiddenSnippets(input.docAText, input.docASpans),
    ...collectHiddenSnippets(input.docBText, input.docBSpans),
  ];

  const similarityFallback = computeSimilarity(input.docAText, input.docBText);
  const rawScore = Number(candidate?.score ?? candidate?.similarity_score ?? similarityFallback);
  const score = Math.min(100, Math.max(0, Number.isFinite(rawScore) ? Math.round(rawScore) : similarityFallback));
  const recommendationRaw = asText(candidate?.recommendation || toRecommendation(score));
  const recommendation =
    recommendationRaw.toLowerCase() === 'high'
      ? 'High'
      : recommendationRaw.toLowerCase() === 'medium'
        ? 'Medium'
        : 'Low';
  const rawConfidence = Number(candidate?.confidence ?? score);
  const confidence = Math.min(100, Math.max(0, Number.isFinite(rawConfidence) ? Math.round(rawConfidence) : score));

  const summary =
    sanitizeTextAgainstHiddenSnippets(asText(candidate?.summary), hiddenSnippets) ||
    sanitizeTextAgainstHiddenSnippets(asText(rawText).slice(0, 400), hiddenSnippets) ||
    `Comparison score ${score}/100. Recommendation: ${recommendation}.`;

  const parsedSections = Array.isArray(candidate?.sections)
    ? candidate.sections
        .map((section, index) => {
          const heading = asText(section?.heading || section?.title) || `Section ${index + 1}`;
          const bullets = sanitizeBullets(section?.bullets, hiddenSnippets);
          if (!bullets.length) return null;
          return {
            key: `section_${index + 1}`,
            heading,
            bullets,
          };
        })
        .filter(Boolean)
    : [];

  const sections =
    parsedSections.length > 0
      ? parsedSections
      : [
          {
            key: 'summary',
            heading: 'Comparison Summary',
            bullets: [summary],
          },
        ];

  const confidentialitySpans = (input.docASpans?.length || 0) + (input.docBSpans?.length || 0);

  return {
    provider: 'vertex',
    model: asText(process.env.VERTEX_MODEL) || 'gemini-1.5-flash-002',
    generatedAt,
    score,
    confidence,
    recommendation,
    summary,
    report: {
      generated_at: generatedAt,
      title: input.title,
      recommendation,
      similarity_score: score,
      confidence_score: confidence,
      delta_characters: Math.abs(String(input.docAText || '').length - String(input.docBText || '').length),
      confidentiality_spans: confidentialitySpans,
      executive_summary: summary,
      sections,
      provider: 'vertex',
      model: asText(process.env.VERTEX_MODEL) || 'gemini-1.5-flash-002',
    },
  };
}

async function callVertex(prompt: string) {
  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    throw new ApiError(501, 'not_configured', 'Vertex AI integration is not configured');
  }

  const accessToken = await fetchGoogleAccessToken(vertex.credentials);
  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location;
  const preferredModel = asText(process.env.VERTEX_MODEL) || vertex.model;
  const modelCandidates = [
    preferredModel,
    'gemini-2.0-flash-001',
    'gemini-1.5-flash-001',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
  ]
    .map((model) => asText(model))
    .filter(Boolean)
    .filter((model, index, values) => values.indexOf(model) === index);

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
          maxOutputTokens: 1400,
          temperature: 0.1,
          topP: 0.9,
        },
      }),
    });

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const text = extractModelText(payload);
      return {
        model,
        text,
      };
    }

    const details = await response.text().catch(() => '');
    lastStatus = response.status;
    lastMessage = details ? details.slice(0, 400) : '';
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

export async function evaluateDocumentComparisonWithVertex(input: ComparisonInput): Promise<ComparisonEvaluation> {
  const normalizedInput: ComparisonInput = {
    title: asText(input.title) || 'Untitled Comparison',
    partyALabel: asText(input.partyALabel) || 'Document A',
    partyBLabel: asText(input.partyBLabel) || 'Document B',
    docAText: String(input.docAText || ''),
    docBText: String(input.docBText || ''),
    docASpans: normalizeSpans(input.docASpans || [], String(input.docAText || '')),
    docBSpans: normalizeSpans(input.docBSpans || [], String(input.docBText || '')),
  };

  if (String(process.env.VERTEX_MOCK || '').trim() === '1') {
    return buildMockComparisonEvaluation(normalizedInput);
  }

  const prompt = buildPrompt(normalizedInput);
  const vertex = await callVertex(prompt);
  const parsed = parseModelJson(vertex.text);
  const evaluation = sanitizeEvaluation(parsed || {}, vertex.text, normalizedInput);
  evaluation.model = vertex.model;
  evaluation.report.model = vertex.model;
  return evaluation;
}
