import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { DEFAULT_TEMPLATE_DEFINITIONS } from './_defaults.js';

type TemplateDefinition = (typeof DEFAULT_TEMPLATE_DEFINITIONS)[number];

type TemplateQuestionShape = {
  id: string;
  section_id: string | null;
  label: string;
  description: string | null;
  field_type: string;
  value_type: string;
  required: boolean;
  visibility_default: string;
  sort_order: number;
  allowed_values: string[];
  module_key: string | null;
  role_type: string;
  applies_to_role: string | null;
  party: string | null;
  is_about_counterparty: boolean;
  supports_visibility: boolean;
  preset_required: Record<string, boolean>;
  preset_visible: Record<string, boolean>;
};

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
    .filter((entry) => entry.length > 0);
}

function toObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function toBooleanRecord(value: unknown) {
  const source = toObject(value);
  const output: Record<string, boolean> = {};

  for (const [key, entry] of Object.entries(source)) {
    output[key] = Boolean(entry);
  }

  return output;
}

function mapQuestionRow(row): TemplateQuestionShape {
  const metadata = toObject(row.metadata);

  return {
    id: row.questionKey,
    section_id: null,
    label: row.label,
    description: row.description || null,
    field_type: row.fieldType || 'text',
    value_type: row.valueType || 'text',
    required: Boolean(row.required),
    visibility_default: row.visibilityDefault || 'full',
    sort_order: Number(row.sortOrder || 0),
    allowed_values: toStringArray(row.options),
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

function mapTemplateRow(row, sectionsByTemplateId, questionsByTemplateId) {
  const metadata = toObject(row.metadata);
  const sectionRows = sectionsByTemplateId.get(row.id) || [];
  const questionRows = questionsByTemplateId.get(row.id) || [];

  const sectionKeyById = new Map(
    sectionRows.map((sectionRow) => [
      sectionRow.id,
      typeof sectionRow.sectionKey === 'string' && sectionRow.sectionKey.trim().length > 0
        ? sectionRow.sectionKey
        : sectionRow.id,
    ]),
  );

  const sections = sectionRows
    .map((sectionRow) => ({
      id: sectionKeyById.get(sectionRow.id),
      title: sectionRow.title,
      description: sectionRow.description || null,
      sort_order: Number(sectionRow.sortOrder || 0),
    }))
    .sort((left, right) => {
      const leftOrder = Number(left.sort_order || 0);
      const rightOrder = Number(right.sort_order || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return String(left.title || '').localeCompare(String(right.title || ''));
    });

  const questions = questionRows
    .map((questionRow) => {
      const mapped = mapQuestionRow(questionRow);
      return {
        ...mapped,
        section_id:
          questionRow.sectionId && sectionKeyById.has(questionRow.sectionId)
            ? sectionKeyById.get(questionRow.sectionId)
            : null,
      };
    })
    .sort((left, right) => {
      const leftOrder = Number(left.sort_order || 0);
      const rightOrder = Number(right.sort_order || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return String(left.label || '').localeCompare(String(right.label || ''));
    });

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    slug: row.slug,
    template_key:
      typeof metadata.template_key === 'string' && metadata.template_key.trim().length > 0
        ? metadata.template_key
        : row.slug,
    category: row.category,
    status: row.status,
    party_a_label: row.partyALabel,
    party_b_label: row.partyBLabel,
    is_tool: Boolean(row.isTool),
    view_count: row.viewCount || 0,
    sort_order: row.sortOrder || 0,
    metadata,
    sections,
    questions,
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
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

function mapDefaultTemplate(definition: TemplateDefinition) {
  const sections = Array.isArray(definition.sections)
    ? definition.sections
        .map((section) => ({
          id: section.key,
          title: section.title,
          description: null,
          sort_order: Number(section.sortOrder || 0),
        }))
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
    : [];

  const questions = Array.isArray(definition.sections)
    ? definition.sections
        .flatMap((section) => {
          const sectionKey = String(section.key || '').trim();
          const sectionQuestions = Array.isArray(section.questions) ? section.questions : [];
          return sectionQuestions.map((question) => mapDefaultQuestion(question, sectionKey));
        })
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
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
    metadata: {
      template_key: definition.templateKey || definition.slug,
    },
    sections,
    questions,
    created_date: null,
    updated_date: null,
  };
}

async function ensureDefaultTemplatesForUser(db: any, userId: string) {
  const existingRows = await db
    .select({
      id: schema.templates.id,
      slug: schema.templates.slug,
      viewCount: schema.templates.viewCount,
    })
    .from(schema.templates)
    .where(eq(schema.templates.userId, userId));

  const bySlug = new Map<string, { id: string; viewCount: number }>(
    existingRows
      .map((row) => [
        String(row.slug || '').trim().toLowerCase(),
        {
          id: row.id,
          viewCount: Number(row.viewCount || 0),
        },
      ])
      .filter(([slug]) => slug.length > 0),
  );

  for (const templateDef of DEFAULT_TEMPLATE_DEFINITIONS) {
    const slugKey = templateDef.slug.toLowerCase();
    let templateRecord = bySlug.get(slugKey) || null;
    let templateId = templateRecord?.id || null;
    const now = new Date();

    if (!templateId) {
      templateId = newId('template');
      await db.insert(schema.templates).values({
        id: templateId,
        userId,
        name: templateDef.name,
        description: templateDef.description,
        slug: templateDef.slug,
        category: templateDef.category,
        status: templateDef.status || 'active',
        partyALabel: templateDef.partyALabel,
        partyBLabel: templateDef.partyBLabel,
        isTool: false,
        viewCount: 0,
        sortOrder: templateDef.sortOrder,
        metadata: {
          template_key: templateDef.templateKey || templateDef.slug,
        },
        createdAt: now,
        updatedAt: now,
      });
      templateRecord = { id: templateId, viewCount: 0 };
      bySlug.set(slugKey, templateRecord);
    } else {
      await db
        .update(schema.templates)
        .set({
          name: templateDef.name,
          description: templateDef.description,
          category: templateDef.category,
          status: templateDef.status || 'active',
          partyALabel: templateDef.partyALabel,
          partyBLabel: templateDef.partyBLabel,
          isTool: false,
          sortOrder: templateDef.sortOrder,
          metadata: {
            template_key: templateDef.templateKey || templateDef.slug,
          },
          updatedAt: now,
        })
        .where(and(eq(schema.templates.id, templateId), eq(schema.templates.userId, userId)));
    }

    const existingQuestionRows = await db
      .select({ questionKey: schema.templateQuestions.questionKey })
      .from(schema.templateQuestions)
      .where(and(eq(schema.templateQuestions.templateId, templateId), eq(schema.templateQuestions.userId, userId)))
      .orderBy(asc(schema.templateQuestions.sortOrder), asc(schema.templateQuestions.createdAt));

    const existingSectionRows = await db
      .select({ sectionKey: schema.templateSections.sectionKey })
      .from(schema.templateSections)
      .where(and(eq(schema.templateSections.templateId, templateId), eq(schema.templateSections.userId, userId)))
      .orderBy(asc(schema.templateSections.sortOrder), asc(schema.templateSections.createdAt));

    const expectedQuestionKeys = templateDef.sections.flatMap((sectionDef) =>
      sectionDef.questions.map((questionDef) => questionDef.key),
    );
    const expectedSectionKeys = templateDef.sections.map((sectionDef) => sectionDef.key);

    const existingQuestionKeys = new Set(
      existingQuestionRows
        .map((row) => String(row.questionKey || '').trim())
        .filter((questionKey) => questionKey.length > 0),
    );
    const existingSectionKeys = new Set(
      existingSectionRows
        .map((row) => String(row.sectionKey || '').trim())
        .filter((sectionKey) => sectionKey.length > 0),
    );

    const needsQuestionSync =
      existingQuestionRows.length !== expectedQuestionKeys.length ||
      expectedQuestionKeys.some((questionKey) => !existingQuestionKeys.has(questionKey));
    const needsSectionSync =
      existingSectionRows.length !== expectedSectionKeys.length ||
      expectedSectionKeys.some((sectionKey) => !existingSectionKeys.has(sectionKey));

    if (!needsQuestionSync && !needsSectionSync) {
      continue;
    }

    await db
      .delete(schema.templateQuestions)
      .where(and(eq(schema.templateQuestions.templateId, templateId), eq(schema.templateQuestions.userId, userId)));
    await db
      .delete(schema.templateSections)
      .where(and(eq(schema.templateSections.templateId, templateId), eq(schema.templateSections.userId, userId)));

    for (const sectionDef of templateDef.sections) {
      const sectionId = newId('section');
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

      for (const questionDef of sectionDef.questions) {
        const visibilityDefault =
          typeof (questionDef as any).visibilityDefault === 'string'
            ? (questionDef as any).visibilityDefault
            : 'full';
        const options = Array.isArray((questionDef as any).options)
          ? (questionDef as any).options
          : [];

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
          visibilityDefault,
          sortOrder: questionDef.sortOrder,
          options,
          metadata: toObject(questionDef.metadata),
          createdAt: now,
          updatedAt: now,
        });
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

    const rows = includeInactive
      ? await db
          .select()
          .from(schema.templates)
          .where(and(eq(schema.templates.userId, auth.user.id), eq(schema.templates.isTool, false)))
          .orderBy(asc(schema.templates.sortOrder), desc(schema.templates.createdAt))
      : await db
          .select()
          .from(schema.templates)
          .where(
            and(
              eq(schema.templates.userId, auth.user.id),
              eq(schema.templates.isTool, false),
              // Baseline default: only active/published templates are listed.
              or(eq(schema.templates.status, 'active'), eq(schema.templates.status, 'published')),
            ),
          )
          .orderBy(asc(schema.templates.sortOrder), desc(schema.templates.createdAt));

    // Include published templates in default list.
    const filteredRows = includeInactive
      ? rows
      : rows.filter((row) => {
          const status = String(row.status || '').toLowerCase();
          return status === 'active' || status === 'published';
        });

    const templateIds = filteredRows.map((row) => row.id);
    const sectionRows =
      templateIds.length > 0
        ? await db
            .select()
            .from(schema.templateSections)
            .where(
              and(
                eq(schema.templateSections.userId, auth.user.id),
                inArray(schema.templateSections.templateId, templateIds),
              ),
            )
            .orderBy(asc(schema.templateSections.sortOrder), asc(schema.templateSections.createdAt))
        : [];

    const questionRows =
      templateIds.length > 0
        ? await db
            .select()
            .from(schema.templateQuestions)
            .where(
              and(
                eq(schema.templateQuestions.userId, auth.user.id),
                inArray(schema.templateQuestions.templateId, templateIds),
              ),
            )
            .orderBy(asc(schema.templateQuestions.sortOrder), asc(schema.templateQuestions.createdAt))
        : [];

    const sectionsByTemplateId = new Map<string, any[]>();
    for (const sectionRow of sectionRows) {
      const existing = sectionsByTemplateId.get(sectionRow.templateId) || [];
      existing.push(sectionRow);
      sectionsByTemplateId.set(sectionRow.templateId, existing);
    }

    const questionsByTemplateId = new Map<string, any[]>();
    for (const questionRow of questionRows) {
      const existing = questionsByTemplateId.get(questionRow.templateId) || [];
      existing.push(questionRow);
      questionsByTemplateId.set(questionRow.templateId, existing);
    }

    const mappedRows = filteredRows.map((row) =>
      mapTemplateRow(row, sectionsByTemplateId, questionsByTemplateId),
    );

    const existingSlugs = new Set(
      mappedRows
        .map((row) => String(row.slug || '').trim().toLowerCase())
        .filter((slug) => slug.length > 0),
    );

    const fallbackTemplates = DEFAULT_TEMPLATE_DEFINITIONS
      .filter((definition) => !existingSlugs.has(definition.slug.toLowerCase()))
      .map(mapDefaultTemplate)
      .filter((template) => {
        if (includeInactive) {
          return true;
        }
        const status = String(template.status || '').toLowerCase();
        return status === 'active' || status === 'published';
      });

    const templates = [...mappedRows, ...fallbackTemplates].sort((left, right) => {
      const leftOrder = Number(left.sort_order || 0);
      const rightOrder = Number(right.sort_order || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const leftCreated = left.created_date ? new Date(left.created_date).getTime() : 0;
      const rightCreated = right.created_date ? new Date(right.created_date).getTime() : 0;
      if (leftCreated !== rightCreated) {
        return rightCreated - leftCreated;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });

    ok(res, 200, {
      templates,
    });
  });
}
