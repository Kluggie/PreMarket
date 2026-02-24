import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { sanitizeEditorText } from '../../../_lib/document-editor-sanitization.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  applyCoachLeakGuard,
  buildCoachCacheHash,
  buildSelectionTextHash,
  COACH_PROMPT_VERSION,
  generateDocumentComparisonCoach,
} from '../../../_lib/vertex-coach.js';
import { ensureComparisonFound } from '../_helpers.js';
import { assertDocumentComparisonWithinLimits } from '../_limits.js';

const ALLOWED_MODES = new Set(['full', 'shared_only', 'selection']);
const ALLOWED_INTENTS = new Set(['improve', 'negotiate', 'risks', 'rewrite']);
const ALLOWED_SELECTION_TARGETS = new Set(['confidential', 'shared']);

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
    return 'improve';
  }
  if (!ALLOWED_INTENTS.has(intent)) {
    throw new ApiError(400, 'invalid_input', 'intent must be one of: improve, negotiate, risks, rewrite');
  }
  return intent as 'improve' | 'negotiate' | 'risks' | 'rewrite';
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

function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function toSafeCoachResult(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/coach', async (context) => {
    ensureMethod(req, ['POST']);

    const comparisonId = getComparisonId(req, comparisonIdParam);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const mode = parseMode(body.mode);
    const intent = parseIntent(body.intent);
    const selectionTarget = parseSelectionTarget(body.selectionTarget || body.selection_target);
    const selectionText = sanitizeEditorText(body.selectionText || body.selection_text || '').slice(0, 20000);

    if (mode === 'selection' && !selectionText) {
      throw new ApiError(400, 'invalid_input', 'selectionText is required when mode=selection');
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.documentComparisons)
      .where(
        and(
          eq(schema.documentComparisons.id, comparisonId),
          eq(schema.documentComparisons.userId, auth.user.id),
        ),
      )
      .limit(1);

    ensureComparisonFound(existing);

    const docAText = sanitizeEditorText(existing.docAText || '');
    const docBText = sanitizeEditorText(existing.docBText || '');
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
    });

    const [cached] = await db
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
      title: existing.title,
      docAText,
      docBText,
      mode,
      intent,
      selectionTarget: selectionTarget || undefined,
      selectionText: selectionText || undefined,
    });
    const guarded = applyCoachLeakGuard({
      coachResult: generated.result,
      confidentialText: docAText,
      sharedText: docBText,
    });

    const now = new Date();
    const [saved] = await db
      .insert(schema.documentComparisonCoachCache)
      .values({
        id: newId('coach'),
        comparisonId,
        userId: auth.user.id,
        cacheHash,
        mode,
        intent,
        selectionTarget: selectionTarget || null,
        selectionTextHash: selectionText ? buildSelectionTextHash(selectionText) : null,
        promptVersion: COACH_PROMPT_VERSION,
        provider: generated.provider,
        model: generated.model,
        result: guarded.coachResult,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.documentComparisonCoachCache.comparisonId, schema.documentComparisonCoachCache.cacheHash],
        set: {
          mode,
          intent,
          selectionTarget: selectionTarget || null,
          selectionTextHash: selectionText ? buildSelectionTextHash(selectionText) : null,
          promptVersion: COACH_PROMPT_VERSION,
          provider: generated.provider,
          model: generated.model,
          result: guarded.coachResult,
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
      coach: toSafeCoachResult(saved?.result || guarded.coachResult),
      created_at: saved?.createdAt || now,
      withheld_count: guarded.withheldCount,
    });
  });
}
