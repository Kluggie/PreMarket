import { ok } from '../../../_lib/api-response.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  applyCoachLeakGuard,
  applyCoachRelevanceGuard,
  buildCoachCacheHash,
  COACH_PROMPT_VERSION,
  generateDocumentComparisonCoach,
} from '../../../_lib/vertex-coach.js';
import { assertDocumentComparisonWithinLimits } from '../../document-comparisons/_limits.js';
import {
  assertGuestAiAssistanceAllowed,
  resolveGuestComparisonPreviewInput,
} from './_guest.js';

const ALLOWED_MODES = new Set(['full', 'shared_only', 'selection']);
const ALLOWED_INTENTS = new Set([
  'improve_shared',
  'negotiate',
  'risks',
  'rewrite_selection',
  'general',
  'custom_prompt',
]);
const ALLOWED_SELECTION_TARGETS = new Set(['confidential', 'shared']);
const MAX_CUSTOM_PROMPT_CHARS = 4000;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMode(value: unknown) {
  const mode = asText(value).toLowerCase();
  if (!mode) {
    return 'full';
  }
  if (!ALLOWED_MODES.has(mode)) {
    throw new ApiError(400, 'invalid_input', 'mode must be one of: full, shared_only, selection');
  }
  return mode as 'full' | 'shared_only' | 'selection';
}

function parseIntent(value: unknown) {
  const intent = asText(value).toLowerCase();
  if (!intent) {
    return 'general';
  }
  if (!ALLOWED_INTENTS.has(intent)) {
    throw new ApiError(
      400,
      'invalid_input',
      'intent must be one of: improve_shared, negotiate, risks, rewrite_selection, general, custom_prompt',
    );
  }
  return intent as
    | 'improve_shared'
    | 'negotiate'
    | 'risks'
    | 'rewrite_selection'
    | 'general'
    | 'custom_prompt';
}

function parseSelectionTarget(value: unknown) {
  const target = asText(value).toLowerCase();
  if (!target) {
    return null;
  }
  if (!ALLOWED_SELECTION_TARGETS.has(target)) {
    throw new ApiError(400, 'invalid_input', 'selectionTarget must be one of: confidential, shared');
  }
  return target as 'confidential' | 'shared';
}

function validateIntentMode(params: {
  intent: 'improve_shared' | 'negotiate' | 'risks' | 'rewrite_selection' | 'general' | 'custom_prompt';
  mode: 'full' | 'shared_only' | 'selection';
  selectionText: string;
  selectionTarget: 'confidential' | 'shared' | null;
  promptText: string;
}) {
  const { intent, mode, selectionText, selectionTarget, promptText } = params;

  if (intent === 'improve_shared' && mode !== 'shared_only') {
    throw new ApiError(400, 'invalid_input', 'improve_shared requires mode=shared_only');
  }

  if (intent === 'rewrite_selection') {
    if (mode !== 'selection') {
      throw new ApiError(400, 'invalid_input', 'rewrite_selection requires mode=selection');
    }
    if (!selectionTarget) {
      throw new ApiError(400, 'invalid_input', 'selectionTarget is required for rewrite_selection');
    }
    if (!selectionText) {
      throw new ApiError(400, 'invalid_input', 'selectionText is required for rewrite_selection');
    }
    return;
  }

  if (mode === 'selection') {
    throw new ApiError(400, 'invalid_input', 'mode=selection is only supported for rewrite_selection');
  }

  if ((intent === 'negotiate' || intent === 'risks' || intent === 'general') && mode !== 'full') {
    throw new ApiError(400, 'invalid_input', `${intent} requires mode=full`);
  }

  if (intent === 'custom_prompt') {
    if (mode !== 'full') {
      throw new ApiError(400, 'invalid_input', 'custom_prompt requires mode=full');
    }
    if (!promptText) {
      throw new ApiError(400, 'invalid_input', 'promptText is required for custom_prompt');
    }
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/public/document-comparisons/coach', async () => {
    ensureMethod(req, ['POST']);

    const body = await readJsonBody(req);
    const previewInput = resolveGuestComparisonPreviewInput(body);
    assertGuestAiAssistanceAllowed(req, previewInput.guestSessionId);

    const mode = parseMode(body.mode);
    const action = asText(body.action).toLowerCase();
    const intent = parseIntent(body.intent || action);
    const selectionTarget = parseSelectionTarget(body.selectionTarget || body.selection_target);
    const selectionText = asText(body.selectionText || body.selection_text).slice(0, 20_000);
    const promptText = asText(body.promptText || body.prompt_text).slice(0, MAX_CUSTOM_PROMPT_CHARS);
    const rawThreadHistory = Array.isArray(body.threadHistory) ? body.threadHistory : [];
    const threadHistory = rawThreadHistory
      .filter((entry: any) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string')
      .slice(-6)
      .map((entry: any) => ({
        role: entry.role as 'user' | 'assistant',
        content: String(entry.content || '').slice(0, 2000),
        ...(entry.promptType ? { promptType: String(entry.promptType) } : {}),
      }));

    validateIntentMode({
      intent,
      mode,
      selectionTarget,
      selectionText,
      promptText,
    });

    assertDocumentComparisonWithinLimits({
      docAText: previewInput.docAText,
      docBText: previewInput.docBText,
    });

    const cacheHash = buildCoachCacheHash({
      docAText: previewInput.docAText,
      docBText: previewInput.docBText,
      model: String(process.env.VERTEX_COACH_MODEL || process.env.VERTEX_MODEL || '').trim(),
      mode,
      intent,
      selectionTarget: selectionTarget || undefined,
      selectionText: selectionText || undefined,
      promptText: promptText || undefined,
      companyName: previewInput.companyName,
      companyWebsite: previewInput.companyWebsite,
      threadHistory: threadHistory.length > 0 ? threadHistory : undefined,
    });

    const generated = await generateDocumentComparisonCoach({
      title: previewInput.title,
      docAText: previewInput.docAText,
      docBText: previewInput.docBText,
      mode,
      intent,
      selectionTarget: selectionTarget || undefined,
      selectionText: selectionText || undefined,
      promptText: promptText || undefined,
      companyName: previewInput.companyName,
      companyWebsite: previewInput.companyWebsite,
      threadHistory: threadHistory.length > 0 ? threadHistory : undefined,
      otherPartyCanaryTokens: [],
    });
    const relevanceGuarded = applyCoachRelevanceGuard({
      coachResult: generated.result,
      confidentialText: previewInput.docAText,
      sharedText: previewInput.docBText,
    });
    const leakGuarded = applyCoachLeakGuard({
      coachResult: relevanceGuarded.coachResult,
      confidentialText: previewInput.docAText,
      sharedText: previewInput.docBText,
    });
    const totalWithheldCount = relevanceGuarded.withheldCount + leakGuarded.withheldCount;

    ok(res, 200, {
      comparison_id: previewInput.guestDraftId,
      cache_hash: cacheHash,
      cached: false,
      provider: generated.provider,
      model: generated.model,
      prompt_version: COACH_PROMPT_VERSION,
      coach: leakGuarded.coachResult,
      created_at: new Date().toISOString(),
      withheld_count: totalWithheldCount,
    });
  });
}
