import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toOptionalText(value: unknown) {
  if (value == null) return null;
  const textValue = String(value).trim();
  return textValue.length > 0 ? textValue : null;
}

function toBoolean(value: unknown) {
  return Boolean(value);
}

function sanitizeOrgInput(source) {
  const socialLinksRaw = source?.social_links && typeof source.social_links === 'object'
    ? source.social_links
    : {};

  return {
    name: String(source?.name || '').trim(),
    pseudonym: toOptionalText(source?.pseudonym),
    type: toOptionalText(source?.type) || 'startup',
    industry: toOptionalText(source?.industry),
    location: toOptionalText(source?.location),
    website: toOptionalText(source?.website),
    bio: toOptionalText(source?.bio),
    isPublicDirectory: toBoolean(source?.is_public_directory),
    socialLinks: {
      linkedin: toOptionalText((socialLinksRaw as any).linkedin) || '',
      twitter: toOptionalText((socialLinksRaw as any).twitter) || '',
      crunchbase: toOptionalText((socialLinksRaw as any).crunchbase) || '',
    },
  };
}

function mapOrganizationRow(organization) {
  return {
    id: organization.id,
    name: organization.name,
    pseudonym: organization.pseudonym || '',
    type: organization.type || 'startup',
    industry: organization.industry || '',
    location: organization.location || '',
    website: organization.website || '',
    bio: organization.bio || '',
    is_public_directory: Boolean(organization.isPublicDirectory),
    social_links: organization.socialLinks || {
      linkedin: '',
      twitter: '',
      crunchbase: '',
    },
    verification_status: organization.verificationStatus || 'unverified',
    created_by_user_id: organization.createdByUserId || null,
    created_date: organization.createdAt,
    updated_date: organization.updatedAt,
  };
}

function mapMembershipRow(membership) {
  return {
    id: membership.id,
    user_id: membership.userId,
    user_email: membership.userEmail,
    organization_id: membership.organizationId,
    role: membership.role,
    status: membership.status,
    created_date: membership.createdAt,
    updated_date: membership.updatedAt,
  };
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/organizations', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const userEmail = normalizeEmail(auth.user.email);

    if (req.method === 'GET') {
      const memberships = await db
        .select()
        .from(schema.memberships)
        .where(
          or(
            eq(schema.memberships.userId, auth.user.id),
            userEmail ? ilike(schema.memberships.userEmail, userEmail) : eq(schema.memberships.userId, auth.user.id),
          ),
        )
        .orderBy(desc(schema.memberships.updatedAt));

      const organizationIds = Array.from(
        new Set(memberships.map((membership) => String(membership.organizationId || '').trim()).filter(Boolean)),
      );

      const organizations =
        organizationIds.length > 0
          ? await db
              .select()
              .from(schema.organizations)
              .where(inArray(schema.organizations.id, organizationIds))
              .orderBy(desc(schema.organizations.updatedAt))
          : [];

      ok(res, 200, {
        memberships: memberships.map(mapMembershipRow),
        organizations: organizations.map(mapOrganizationRow),
      });
      return;
    }

    const body = await readJsonBody(req);
    const source = body.organization && typeof body.organization === 'object' ? body.organization : body;
    const input = sanitizeOrgInput(source);

    if (!input.name) {
      throw new ApiError(400, 'invalid_input', 'Organization name is required');
    }

    const now = new Date();
    const organizationId = newId('org');

    const [organization] = await db
      .insert(schema.organizations)
      .values({
        id: organizationId,
        name: input.name,
        pseudonym: input.pseudonym,
        type: input.type,
        industry: input.industry,
        location: input.location,
        website: input.website,
        bio: input.bio,
        isPublicDirectory: input.isPublicDirectory,
        socialLinks: input.socialLinks,
        verificationStatus: 'unverified',
        createdByUserId: auth.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [membership] = await db
      .insert(schema.memberships)
      .values({
        id: newId('member'),
        userId: auth.user.id,
        userEmail,
        organizationId,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    ok(res, 201, {
      organization: mapOrganizationRow(organization),
      membership: mapMembershipRow(membership),
    });
  });
}
