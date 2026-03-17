/**
 * GET /api/public/templates
 *
 * Returns the canonical (built-in) template definitions without requiring
 * authentication. Used by the signed-out guest opportunity creation flow.
 *
 * Only active/published templates are returned. No DB reads or writes occur
 * so this endpoint is safe to expose publicly.
 *
 * Rate limit: 60 requests per IP per minute (in-memory, resets on server restart).
 * Cache:       CDN/browser caches for 5 minutes; stale-while-revalidate 60s.
 */
import { clientIpForRateLimit } from '../../_lib/security.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { DEFAULT_TEMPLATE_DEFINITIONS } from '../templates/_defaults.js';

// Re-export so existing imports from this module continue to work.
export { clientIpForRateLimit };

// ── Lightweight in-memory rate limiter ───────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;   // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 60;    // requests per window per IP

interface RateLimitEntry { count: number; windowStart: number; }
const rateLimitMap = new Map<string, RateLimitEntry>();

// Purge stale entries every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 5 * 60_000).unref();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v || '').trim()))
    .filter((v) => v.length > 0);
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toBooleanRecord(value: unknown): Record<string, boolean> {
  const source = toObject(value);
  const output: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(source)) {
    output[k] = Boolean(v);
  }
  return output;
}

function mapDefaultQuestion(questionDef: any, sectionKey: string) {
  const metadata = toObject(questionDef.metadata);
  return {
    id: questionDef.key,
    section_id: sectionKey,
    label: questionDef.label,
    description: questionDef.description || null,
    field_type: questionDef.fieldType || 'text',
    value_type: questionDef.valueType || 'text',
    required: Boolean(questionDef.required),
    visibility_default: questionDef.visibilityDefault || 'full',
    sort_order: Number(questionDef.sortOrder || 0),
    allowed_values: toStringArray(questionDef.options),
    module_key:
      typeof metadata.module_key === 'string' && metadata.module_key.trim().length > 0
        ? metadata.module_key.trim()
        : null,
    role_type:
      typeof metadata.role_type === 'string' && metadata.role_type.trim().length > 0
        ? metadata.role_type.trim()
        : 'party_attribute',
    applies_to_role:
      typeof metadata.applies_to_role === 'string' && metadata.applies_to_role.trim().length > 0
        ? metadata.applies_to_role.trim()
        : null,
    party:
      typeof metadata.party === 'string' && metadata.party.trim().length > 0
        ? metadata.party.trim()
        : null,
    is_about_counterparty: Boolean(metadata.is_about_counterparty),
    supports_visibility: Boolean(metadata.supports_visibility),
    preset_required: toBooleanRecord(metadata.preset_required),
    preset_visible: toBooleanRecord(metadata.preset_visible),
  };
}

function mapDefaultTemplate(definition: (typeof DEFAULT_TEMPLATE_DEFINITIONS)[number]) {
  const sections = Array.isArray(definition.sections)
    ? definition.sections
        .map((s) => ({
          id: s.key,
          title: s.title,
          description: null,
          sort_order: Number(s.sortOrder || 0),
        }))
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    : [];

  const questions = Array.isArray(definition.sections)
    ? definition.sections
        .flatMap((s) => {
          const sectionKey = String(s.key || '').trim();
          return (Array.isArray(s.questions) ? s.questions : []).map((q) =>
            mapDefaultQuestion(q, sectionKey),
          );
        })
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    : [];

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    slug: definition.slug,
    template_key: definition.templateKey || definition.slug,
    category: definition.category,
    status: definition.status || 'active',
    party_a_label: definition.partyALabel,
    party_b_label: definition.partyBLabel,
    is_tool: false,
    view_count: 0,
    sort_order: definition.sortOrder || 0,
    metadata: { template_key: definition.templateKey || definition.slug },
    sections,
    questions,
    created_date: null,
    updated_date: null,
  };
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/public/templates', async () => {
    ensureMethod(req, ['GET']);

    // Rate limiting.
    const ip = clientIpForRateLimit(req);
    if (isRateLimited(ip)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
      return;
    }

    const templates = DEFAULT_TEMPLATE_DEFINITIONS
      .filter((def) => {
        const status = String(def.status || 'active').toLowerCase();
        return status === 'active' || status === 'published';
      })
      .map(mapDefaultTemplate)
      .sort((a, b) => {
        const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

    // Write response manually so Cache-Control is not overridden by the shared json() helper.
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.setHeader('Surrogate-Control', 'max-age=300');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(JSON.stringify({ ok: true, templates }));
  });
}
