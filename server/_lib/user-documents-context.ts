/**
 * Relevance-based document context selection for AI evaluations.
 *
 * Only includes document summaries when they are relevant to the proposal context.
 * Uses a lightweight keyword-overlap heuristic with an optional LLM relevance pass.
 *
 * IMPORTANT: This context is supplementary only.
 * - Missing documents must NOT be treated as negatives.
 * - Document context is supplementary; proposal content and evidence take priority.
 */

import { eq, desc } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';

const MAX_DOCS_FOR_CONTEXT = 3;
const MAX_SUMMARY_CHARS = 800;
const MAX_DOCS_TO_FETCH = 20; // Fetch more than we'll use, to enable selection

// Stopwords excluded from keyword matching
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'will',
  'your', 'all', 'any', 'are', 'not', 'been', 'they', 'what', 'which',
  'their', 'more', 'also', 'into', 'over', 'when', 'some', 'each',
  'than', 'then', 'both', 'such', 'only', 'after', 'about', 'other',
]);

export type UserDocumentContext = {
  contextBlock: string;
  docCount: number;
};

export type UserDocumentVisibility = 'confidential' | 'shared';

type DocSummary = {
  id: string;
  filename: string;
  summaryText: string | null;
  extractedText: string | null;
  visibility: UserDocumentVisibility;
};

type SelectRelevantDocumentsOptions = {
  includeConfidential?: boolean;
};

function normalizeVisibility(value: unknown): UserDocumentVisibility {
  return String(value || '').toLowerCase() === 'shared' ? 'shared' : 'confidential';
}

// ---------------------------------------------------------------------------
// Keyword relevance scorer
// ---------------------------------------------------------------------------
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().match(/\b[a-z]{4,}\b/g) || []) {
    if (!STOPWORDS.has(word)) tokens.add(word);
  }
  return tokens;
}

function scoreDocRelevance(doc: DocSummary, proposalTokens: Set<string>): number {
  const docText = `${doc.filename} ${doc.summaryText || ''} ${(doc.extractedText || '').slice(0, 1000)}`;
  const docTokens = tokenize(docText);
  let hits = 0;
  for (const token of proposalTokens) {
    if (docTokens.has(token)) hits++;
  }
  return hits;
}

function keywordSelect(docs: DocSummary[], proposalContext: string): DocSummary[] {
  if (!proposalContext.trim()) return [];
  const tokens = tokenize(proposalContext);
  if (!tokens.size) return [];

  const scored = docs
    .map((doc) => ({ doc, score: scoreDocRelevance(doc, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOCS_FOR_CONTEXT);

  return scored.map(({ doc }) => doc);
}

// ---------------------------------------------------------------------------
// LLM relevance selector (best-effort; falls back to keyword on failure)
// ---------------------------------------------------------------------------
async function llmSelect(
  docs: DocSummary[],
  proposalContext: string,
): Promise<DocSummary[] | null> {
  try {
    const { getVertexConfig } = await import('./integrations.js');
    const vertexConfig = getVertexConfig();
    if (!vertexConfig.ready || !vertexConfig.credentials) return null;

    const { createSign } = await import('node:crypto');
    const creds = vertexConfig.credentials;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claimset = Buffer.from(
      JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      }),
    ).toString('base64url');

    const unsignedJwt = `${header}.${claimset}`;
    const signer = createSign('RSA-SHA256');
    signer.write(unsignedJwt);
    signer.end();
    const sig = signer.sign(creds.private_key, 'base64url');
    const jwt = `${unsignedJwt}.${sig}`;

    const tokenRes = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
    if (!tokenRes.ok) return null;

    const tokenBody: any = await tokenRes.json();
    const accessToken = String(tokenBody?.access_token || '').trim();
    if (!accessToken) return null;

    const projectId = (process.env.GCP_PROJECT_ID || '').trim() || creds.project_id;
    const location = (process.env.GCP_LOCATION || 'us-central1').trim();
    const model = (process.env.VERTEX_MODEL || 'gemini-2.0-flash-001').trim();

    const docList = docs
      .map((d, i) => `${i}: id="${d.id}" filename="${d.filename}" summary="${(d.summaryText || '').slice(0, 300)}"`)
      .join('\n');

    const prompt =
      `You are selecting which of the user's uploaded documents are relevant to a proposal evaluation.\n\n` +
      `PROPOSAL CONTEXT (brief):\n${proposalContext.slice(0, 800)}\n\n` +
      `USER DOCUMENTS (${docs.length} total):\n${docList}\n\n` +
      `Select at most ${MAX_DOCS_FOR_CONTEXT} document IDs that are DIRECTLY relevant to this proposal.\n` +
      `If none are relevant, return an empty array.\n` +
      `Return ONLY a JSON array of document ID strings, e.g. ["id1","id2"]. No other text.`;

    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

    const genRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 128, temperature: 0 },
      }),
      // @ts-ignore
      signal: AbortSignal.timeout ? AbortSignal.timeout(8_000) : undefined,
    });
    if (!genRes.ok) return null;

    const genBody: any = await genRes.json();
    const rawText = String(genBody?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    // Extract JSON array from the response
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const selectedIds: string[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(selectedIds)) return null;

    const selectedSet = new Set(selectedIds.map(String));
    return docs.filter((d) => selectedSet.has(d.id)).slice(0, MAX_DOCS_FOR_CONTEXT);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select relevant documents for a proposal evaluation.
 *
 * @param userId        Owner of the documents
 * @param proposalContext  Short text summary of the proposal (title + key fields).
 *                         If empty, no documents are included.
 *
 * Returns a formatted context block for prompt injection, or null if no relevant docs.
 */
export async function selectRelevantDocuments(
  userId: string,
  proposalContext: string,
  options: SelectRelevantDocumentsOptions = {},
): Promise<UserDocumentContext | null> {
  if (!userId || !proposalContext.trim()) return null;
  const includeConfidential = options.includeConfidential !== false;

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.userDocuments.id,
        filename: schema.userDocuments.filename,
        summaryText: schema.userDocuments.summaryText,
        extractedText: schema.userDocuments.extractedText,
        status: schema.userDocuments.status,
        visibility: schema.userDocuments.visibility,
      })
      .from(schema.userDocuments)
      .where(eq(schema.userDocuments.userId, userId))
      .orderBy(desc(schema.userDocuments.createdAt))
      .limit(MAX_DOCS_TO_FETCH);

    // Only use docs that have been processed and have some text
    const candidateDocs: DocSummary[] = rows
      .filter((d) => d.status === 'ready' && (d.summaryText || d.extractedText))
      .filter((d) => includeConfidential || normalizeVisibility(d.visibility) === 'shared')
      .map((d) => ({
        id: d.id,
        filename: d.filename,
        summaryText: d.summaryText,
        extractedText: d.extractedText,
        visibility: normalizeVisibility(d.visibility),
      }));

    if (!candidateDocs.length) return null;

    // Select relevant docs: try LLM first, fall back to keyword heuristic
    let selectedDocs: DocSummary[] = [];

    if (candidateDocs.length <= MAX_DOCS_FOR_CONTEXT) {
      // Only a few docs — still check relevance via keywords before including
      const kwSelected = keywordSelect(candidateDocs, proposalContext);
      selectedDocs = kwSelected;
    } else {
      // Multiple docs: try LLM selection, fall back to keyword
      const llmResult = await llmSelect(candidateDocs, proposalContext).catch(() => null);
      selectedDocs = llmResult !== null ? llmResult : keywordSelect(candidateDocs, proposalContext);
    }

    if (!selectedDocs.length) return null;

    const parts: string[] = [];
    for (const doc of selectedDocs) {
      const safeFilename = String(doc.filename || 'document').replace(/[`"]/g, '');
      const content = doc.summaryText
        ? String(doc.summaryText).slice(0, MAX_SUMMARY_CHARS)
        : String(doc.extractedText || '').slice(0, 400) + '...';

      if (!content.trim()) continue;
      parts.push(`[Document: ${safeFilename} | visibility=${doc.visibility}]\n${content.trim()}`);
    }

    if (!parts.length) return null;

    const contextBlock =
      `---\n` +
      `SUPPLEMENTARY CONTEXT (user-provided documents — treat as background reference only):\n` +
      `Important: Missing documents must NOT be treated as negatives.\n` +
      `Prioritise proposal content and objective evidence over this context.\n\n` +
      parts.join('\n\n') +
      `\n---`;

    return { contextBlock, docCount: parts.length };
  } catch {
    return null;
  }
}

/**
 * Backward-compatible alias. Fetches user documents without a proposal context
 * (always returns null since relevance filtering requires a context).
 * Kept for any callers that don't have proposal context available.
 */
export async function getUserDocumentContext(userId: string): Promise<UserDocumentContext | null> {
  return null;
}
