import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { appendProposalHistory } from '../../../_lib/proposal-history.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { getDefaultTemplateById } from '../_defaults.js';

function getTemplateId(req: any, templateIdParam?: string) {
  if (templateIdParam && templateIdParam.trim().length > 0) {
    return templateIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function mapProposalRow(proposal, ownerEmail) {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    party_a_email: proposal.partyAEmail || ownerEmail,
    party_b_email: proposal.partyBEmail,
    summary: proposal.summary,
    payload: proposal.payload || {},
    user_id: proposal.userId,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildFallbackQuestions(templateDefinition) {
  if (!templateDefinition?.sections || !Array.isArray(templateDefinition.sections)) {
    return [];
  }

  return templateDefinition.sections.flatMap((section) => {
    const sectionKey = String(section?.key || '').trim() || null;
    const questions = Array.isArray(section?.questions) ? section.questions : [];

    return questions.map((question) => ({
      id: String(question.key || '').trim() || `${templateDefinition.id}:${sectionKey || 'section'}`,
      sectionId: sectionKey,
      valueType: question.valueType || 'text',
      visibilityDefault: question.visibilityDefault || 'full',
    }));
  });
}

export default async function handler(req: any, res: any, templateIdParam?: string) {
  await withApiRoute(req, res, '/api/templates/[id]/use', async (context) => {
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
    const [template] = await db
      .select()
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.id, templateId),
          or(eq(schema.templates.userId, auth.user.id), isNull(schema.templates.userId)),
        ),
      )
      .limit(1);

    const fallbackTemplate = template ? null : getDefaultTemplateById(templateId);

    if (!template && !fallbackTemplate) {
      throw new ApiError(404, 'template_not_found', 'Template not found');
    }

    const effectiveTemplateId = template?.id || fallbackTemplate.id;
    const templateMetadata =
      template && template.metadata && typeof template.metadata === 'object' ? template.metadata : {};

    const metadataTemplateKey =
      typeof templateMetadata?.template_key === 'string' && templateMetadata.template_key.trim().length > 0
        ? templateMetadata.template_key.trim()
        : null;

    const effectiveTemplateSlug = template?.slug || fallbackTemplate.slug;
    const effectiveTemplateKey = metadataTemplateKey || fallbackTemplate.templateKey || effectiveTemplateSlug;
    const effectiveTemplateCategory = template?.category || fallbackTemplate.category;
    const effectiveTemplateName = template?.name || fallbackTemplate.name;
    const effectiveTemplateDescription = template?.description || fallbackTemplate.description || null;

    const body = await readJsonBody(req);
    const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || '').trim() || null;

    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(schema.proposals)
        .where(
          and(
            eq(schema.proposals.userId, auth.user.id),
            eq(schema.proposals.templateId, effectiveTemplateId),
            sql`${schema.proposals.payload} ->> 'template_use_idempotency_key' = ${idempotencyKey}`,
          ),
        )
        .orderBy(desc(schema.proposals.createdAt))
        .limit(1);

      if (existing) {
        ok(res, 200, {
          proposal: mapProposalRow(existing, auth.user.email),
          idempotent: true,
        });
        return;
      }
    }

    const now = new Date();
    const proposalId = newId('proposal');
    const proposalPayload = {
      template_slug: effectiveTemplateSlug,
      template_key: effectiveTemplateKey,
      template_category: effectiveTemplateCategory,
      template_use_idempotency_key: idempotencyKey,
    };

    const title = String(body.title || `${effectiveTemplateName} Proposal`).trim();
    const partyBEmail = normalizeEmail(body.partyBEmail || body.party_b_email || '') || null;

    const [createdProposal] = await db
      .insert(schema.proposals)
      .values({
        id: proposalId,
        userId: auth.user.id,
        title,
        status: 'draft',
        templateId: effectiveTemplateId,
        templateName: effectiveTemplateName,
        partyAEmail: normalizeEmail(auth.user.email) || null,
        partyBEmail,
        summary: effectiveTemplateDescription,
        payload: proposalPayload,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const templateQuestions = template
      ? await db
          .select()
          .from(schema.templateQuestions)
          .where(eq(schema.templateQuestions.templateId, template.id))
          .orderBy(asc(schema.templateQuestions.sortOrder), asc(schema.templateQuestions.createdAt))
      : buildFallbackQuestions(fallbackTemplate);

    if (templateQuestions.length > 0) {
      await db.insert(schema.proposalResponses).values(
        templateQuestions.map((question) => ({
          id: newId('response'),
          proposalId: createdProposal.id,
          userId: auth.user.id,
          questionId: question.questionKey || question.id,
          sectionId: question.sectionId || null,
          value: null,
          valueType: question.valueType || 'text',
          rangeMin: null,
          rangeMax: null,
          visibility: question.visibilityDefault || 'full',
          claimType: null,
          enteredByParty: 'a',
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const snapshotId = newId('snapshot');
    await db.insert(schema.proposalSnapshots).values({
      id: snapshotId,
      sourceProposalId: createdProposal.id,
      proposalId: createdProposal.id,
      userId: auth.user.id,
      snapshotVersion: 1,
      status: 'active',
      snapshotData: {
        templateId: effectiveTemplateId,
        templateName: effectiveTemplateName,
        proposalId: createdProposal.id,
      },
      snapshotMeta: {
        createdFrom: 'template_use',
      },
      createdAt: now,
      updatedAt: now,
    });

    await appendProposalHistory(db, {
      proposal: createdProposal,
      actorUserId: auth.user.id,
      actorRole: 'party_a',
      milestone: 'create',
      eventType: 'proposal.created',
      createdAt: now,
      requestId: context.requestId,
      eventData: {
        source: 'template_use',
        template_id: effectiveTemplateId,
      },
    });

    ok(res, 201, {
      proposal: mapProposalRow(createdProposal, auth.user.email),
      snapshot: {
        id: snapshotId,
        version: 1,
      },
      idempotent: false,
    });
  });
}
