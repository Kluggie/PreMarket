import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { schema } from '../../../_lib/db/client.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  applyCoachLeakGuard,
  applyCoachRelevanceGuard,
  buildCoachCacheHash,
  buildSelectionTextHash,
  COACH_PROMPT_VERSION,
  generateDocumentComparisonCoach,
} from '../../../_lib/vertex-coach.js';
import { assertDocumentComparisonWithinLimits } from '../../document-comparisons/_limits.js';
import {
  SHARED_REPORT_ROUTE,
  buildDefaultConfidentialPayload,
  buildDefaultSharedPayload,
  getCurrentRecipientDraft,
  getPayloadText,
  getToken,
  logTokenEvent,
  requireRecipientAuthorization,
  resolveSharedReportToken,
  toObject,
} from '../_shared.js';

const SHARED_REPORT_COACH_ROUTE = `${SHARED_REPORT_ROUTE}/coach`;
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

function coercePayloadText(payload: unknown, fallbackText = '') {
  const text = getPayloadText(payload, fallbackText);
  if (text) {
    return sanitizeEditorText(text);
  }
  return '';
}

function coercePayloadHtml(payload: unknown, fallbackText = '') {
  const source = toObject(payload);
  const html = asText(source.html);
  if (html) {
    return sanitizeEditorHtml(html);
  }
  const text = getPayloadText(payload, fallbackText);
  return sanitizeEditorHtml(text);
}

function resolveCoachDocumentSide(params: {
  requestText: unknown;
  requestHtml: unknown;
  payload: unknown;
  fallbackText?: string;
}) {
  const hasRequestText = params.requestText !== undefined;
  const hasRequestHtml = params.requestHtml !== undefined;
  const requestText = asText(params.requestText);
  const requestHtml = asText(params.requestHtml);
  const payloadText = coercePayloadText(params.payload, params.fallbackText || '');
  const payloadHtml = coercePayloadHtml(params.payload, payloadText || params.fallbackText || '');
  const source = hasRequestText || hasRequestHtml ? 'request' : 'draft';
  const rawText = source === 'request' ? requestText : payloadText;
  const rawHtml = source === 'request' ? requestHtml : payloadHtml;
  const html = sanitizeEditorHtml(rawHtml || rawText || '');
  const text = sanitizeEditorText(rawText || htmlToEditorText(html));

  return {
    source,
    text,
    html,
  };
}

function toSafeCoachResult(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_COACH_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok || !auth.user) {
      return;
    }
    context.userId = auth.user.id;

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    logTokenEvent(context, 'coach_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
      enforceMaxUses: false,
    });
    requireRecipientAuthorization(resolved.link, auth.user);

    if (!resolved.link.canReevaluate) {
      throw new ApiError(403, 'reevaluation_not_allowed', 'AI support is disabled for this link');
    }

    const comparisonId = asText(resolved.comparison?.id || resolved.proposal?.documentComparisonId);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is unavailable for AI support');
    }

    const body = await readJsonBody(req);
    const mode = parseMode(body.mode);
    const action = asText(body.action).toLowerCase();
    const intent = parseIntent(body.intent || action);
    const selectionTarget = parseSelectionTarget(body.selectionTarget || body.selection_target);
    const selectionText = sanitizeEditorText(body.selectionText || body.selection_text || '').slice(0, 20000);
    const promptText = asText(body.promptText || body.prompt_text || '').slice(0, MAX_CUSTOM_PROMPT_CHARS);
    validateIntentMode({
      intent,
      mode,
      selectionTarget,
      selectionText,
      promptText,
    });

    const currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    const defaultSharedPayload = buildDefaultSharedPayload({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const defaultConfidentialPayload = buildDefaultConfidentialPayload();
    const sharedPayload = currentDraft
      ? toObject(currentDraft.sharedPayload)
      : defaultSharedPayload;
    const confidentialPayload = currentDraft
      ? toObject(currentDraft.recipientConfidentialPayload)
      : defaultConfidentialPayload;
    const useRequestDocumentOverrides = intent !== 'custom_prompt';

    const resolvedDocA = resolveCoachDocumentSide({
      requestText: useRequestDocumentOverrides ? body.docAText ?? body.doc_a_text : undefined,
      requestHtml: useRequestDocumentOverrides ? body.docAHtml ?? body.doc_a_html : undefined,
      payload: confidentialPayload,
      fallbackText: '',
    });
    const sharedFallbackText = String(resolved.comparison?.docBText || defaultSharedPayload.text || '');
    const resolvedDocB = resolveCoachDocumentSide({
      requestText: useRequestDocumentOverrides ? body.docBText ?? body.doc_b_text : undefined,
      requestHtml: useRequestDocumentOverrides ? body.docBHtml ?? body.doc_b_html : undefined,
      payload: sharedPayload,
      fallbackText: sharedFallbackText,
    });

    const docAText = resolvedDocA.text;
    const docBText = resolvedDocB.text;

    assertDocumentComparisonWithinLimits({
      docAText,
      docBText,
    });

    const modelForHash = String(process.env.VERTEX_COACH_MODEL || process.env.VERTEX_MODEL || '').trim();
    const cacheHash = buildCoachCacheHash({
      docAText,
      docBText,
      model: modelForHash,
      mode,
      intent,
      selectionTarget: selectionTarget || undefined,
      selectionText: selectionText || undefined,
      promptText: promptText || undefined,
    });

    const [cached] = await resolved.db
      .select()
      .from(schema.documentComparisonCoachCache)
      .where(
        and(
          eq(schema.documentComparisonCoachCache.comparisonId, comparisonId),
          eq(schema.documentComparisonCoachCache.cacheHash, cacheHash),
        ),
      )
      .orderBy(desc(schema.documentComparisonCoachCache.createdAt))
      .limit(1);

    if (cached) {
      ok(res, 200, {
        comparison_id: comparisonId,
        cache_hash: cacheHash,
        cached: true,
        provider: cached.provider || 'vertex',
        model: cached.model || 'unknown',
        prompt_version: cached.promptVersion || COACH_PROMPT_VERSION,
        coach: toSafeCoachResult(cached.result),
        created_at: cached.createdAt,
      });
      return;
    }

    const generated = await generateDocumentComparisonCoach({
      title: asText(resolved.comparison?.title) || asText(resolved.proposal?.title) || 'Shared Proposal',
      docAText,
      docBText,
      mode,
      intent,
      selectionTarget: selectionTarget || undefined,
      selectionText: selectionText || undefined,
      promptText: promptText || undefined,
    });
    const relevanceGuarded = applyCoachRelevanceGuard({
      coachResult: generated.result,
      confidentialText: docAText,
      sharedText: docBText,
    });
    const leakGuarded = applyCoachLeakGuard({
      coachResult: relevanceGuarded.coachResult,
      confidentialText: docAText,
      sharedText: docBText,
    });
    const totalWithheldCount = relevanceGuarded.withheldCount + leakGuarded.withheldCount;

    const now = new Date();
    const [saved] = await resolved.db
      .insert(schema.documentComparisonCoachCache)
      .values({
        id: newId('coach'),
        comparisonId,
        userId: auth.user.id,
        cacheHash,
        mode,
        intent,
        selectionTarget: selectionTarget || null,
        selectionTextHash: selectionText
          ? buildSelectionTextHash(selectionText)
          : promptText
            ? buildSelectionTextHash(promptText)
            : null,
        promptVersion: COACH_PROMPT_VERSION,
        provider: generated.provider,
        model: generated.model,
        result: leakGuarded.coachResult,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.documentComparisonCoachCache.comparisonId, schema.documentComparisonCoachCache.cacheHash],
        set: {
          mode,
          intent,
          selectionTarget: selectionTarget || null,
          selectionTextHash: selectionText
            ? buildSelectionTextHash(selectionText)
            : promptText
              ? buildSelectionTextHash(promptText)
              : null,
          promptVersion: COACH_PROMPT_VERSION,
          provider: generated.provider,
          model: generated.model,
          result: leakGuarded.coachResult,
          updatedAt: now,
        },
      })
      .returning();

    ok(res, 200, {
      comparison_id: comparisonId,
      cache_hash: cacheHash,
      cached: false,
      provider: generated.provider,
      model: generated.model,
      prompt_version: COACH_PROMPT_VERSION,
      coach: toSafeCoachResult(saved?.result || leakGuarded.coachResult),
      created_at: saved?.createdAt || now,
      withheld_count: totalWithheldCount,
    });

    logTokenEvent(context, 'coach_success', token, {
      linkId: resolved.link.id,
      comparisonId,
      cacheHit: false,
      intent,
      mode,
    });
  });
}
