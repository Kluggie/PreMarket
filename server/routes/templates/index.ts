import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { DEFAULT_TEMPLATE_DEFINITIONS } from './_defaults.js';

function mapTemplateRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    slug: row.slug,
    category: row.category,
    status: row.status,
    party_a_label: row.partyALabel,
    party_b_label: row.partyBLabel,
    is_tool: Boolean(row.isTool),
    view_count: row.viewCount || 0,
    sort_order: row.sortOrder || 0,
    metadata: row.metadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

function mapDefaultTemplate(definition) {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    slug: definition.slug,
    category: definition.category,
    status: 'active',
    party_a_label: definition.partyALabel,
    party_b_label: definition.partyBLabel,
    is_tool: false,
    view_count: 0,
    sort_order: definition.sortOrder || 0,
    metadata: {},
    created_date: null,
    updated_date: null,
  };
}

async function ensureDefaultTemplatesForUser(db: any, userId: string) {
  const existingRows = await db
    .select({
      id: schema.templates.id,
      slug: schema.templates.slug,
    })
    .from(schema.templates)
    .where(or(eq(schema.templates.userId, userId), isNull(schema.templates.userId)));

  const bySlug = new Map(
    existingRows
      .map((row) => [String(row.slug || '').trim().toLowerCase(), row.id])
      .filter(([slug]) => slug.length > 0),
  );

  for (const templateDef of DEFAULT_TEMPLATE_DEFINITIONS) {
    const slugKey = templateDef.slug.toLowerCase();
    if (bySlug.has(slugKey)) {
      continue;
    }

    const now = new Date();
    const templateId = newId('template');

    try {
      await db.insert(schema.templates).values({
        id: templateId,
        userId,
        name: templateDef.name,
        description: templateDef.description,
        slug: templateDef.slug,
        category: templateDef.category,
        status: 'active',
        partyALabel: templateDef.partyALabel,
        partyBLabel: templateDef.partyBLabel,
        isTool: false,
        viewCount: 0,
        sortOrder: templateDef.sortOrder,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      continue;
    }

    for (const sectionDef of templateDef.sections) {
      const sectionId = newId('section');
      try {
        await db.insert(schema.templateSections).values({
          id: sectionId,
          templateId,
          userId,
          sectionKey: sectionDef.key,
          title: sectionDef.title,
          description: null,
          sortOrder: sectionDef.sortOrder,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        continue;
      }

      for (const questionDef of sectionDef.questions) {
        try {
          await db.insert(schema.templateQuestions).values({
            id: newId('question'),
            templateId,
            sectionId,
            userId,
            questionKey: questionDef.key,
            label: questionDef.label,
            description: questionDef.description,
            fieldType: questionDef.fieldType,
            valueType: questionDef.valueType,
            required: Boolean(questionDef.required),
            visibilityDefault: 'full',
            sortOrder: questionDef.sortOrder,
            options: [],
            metadata: {},
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          continue;
        }
      }
    }
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/templates', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    await ensureDefaultTemplatesForUser(db, auth.user.id);

    const includeInactive = String(req.query?.include_inactive || '').toLowerCase() === 'true';
    const ownershipScope = or(eq(schema.templates.userId, auth.user.id), isNull(schema.templates.userId));
    const whereClause = includeInactive
      ? ownershipScope
      : and(
          ownershipScope,
          or(eq(schema.templates.status, 'active'), eq(schema.templates.status, 'published')),
        );

    const rows = await db
      .select()
      .from(schema.templates)
      .where(whereClause)
      .orderBy(asc(schema.templates.sortOrder), desc(schema.templates.createdAt));

    const mappedRows = rows.map(mapTemplateRow);
    const existingSlugs = new Set(
      mappedRows
        .map((row) => String(row.slug || '').trim().toLowerCase())
        .filter((slug) => slug.length > 0),
    );

    const fallbackTemplates = DEFAULT_TEMPLATE_DEFINITIONS
      .filter((definition) => !existingSlugs.has(definition.slug.toLowerCase()))
      .map(mapDefaultTemplate);

    const templates = [...mappedRows, ...fallbackTemplates].sort((left, right) => {
      const leftOrder = Number(left.sort_order || 0);
      const rightOrder = Number(right.sort_order || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    });

    ok(res, 200, {
      templates,
    });
  });
}
