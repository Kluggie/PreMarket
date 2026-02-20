import { and, eq, sql } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getTemplateId(req: any, templateIdParam?: string) {
  if (templateIdParam && templateIdParam.trim().length > 0) {
    return templateIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export default async function handler(req: any, res: any, templateIdParam?: string) {
  await withApiRoute(req, res, '/api/templates/[id]/view', async (context) => {
    ensureMethod(req, ['POST']);

    const templateId = getTemplateId(req, templateIdParam);
    if (!templateId) {
      throw new ApiError(400, 'invalid_input', 'Template id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    const [updated] = await db
      .update(schema.templates)
      .set({
        viewCount: sql`${schema.templates.viewCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.templates.id, templateId), eq(schema.templates.userId, auth.user.id)))
      .returning({
        id: schema.templates.id,
        viewCount: schema.templates.viewCount,
      });

    if (!updated) {
      throw new ApiError(404, 'template_not_found', 'Template not found');
    }

    ok(res, 200, {
      template: {
        id: updated.id,
        view_count: Number(updated.viewCount || 0),
      },
    });
  });
}
