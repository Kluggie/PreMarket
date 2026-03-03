import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const MAX_NAME_LENGTH = 160;
const MAX_PSEUDONYM_LENGTH = 80;
const MAX_TYPE_LENGTH = 80;
const MAX_TAGLINE_LENGTH = 80;
const MAX_INDUSTRY_LENGTH = 80;
const MAX_LOCATION_LENGTH = 120;
const MAX_BIO_LENGTH = 2000;
const MAX_URL_LENGTH = 280;

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toOptionalText(value: unknown, maxLength = 2000) {
  if (value == null) return null;
  const textValue = String(value).trim();
  if (!textValue.length) {
    return null;
  }

  return textValue.slice(0, maxLength);
}

function toBoolean(value: unknown) {
  return Boolean(value);
}

function normalizeUrlValue(value: unknown, fieldName: string) {
  const textValue = toOptionalText(value, MAX_URL_LENGTH + 1);
  if (!textValue) {
    return null;
  }

  if (textValue.length > MAX_URL_LENGTH) {
    throw new ApiError(400, 'invalid_input', `${fieldName} must be ${MAX_URL_LENGTH} characters or fewer`, {
      field: fieldName,
    });
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(textValue) ? textValue : `https://${textValue}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ApiError(400, 'invalid_input', `Invalid URL for ${fieldName}`, {
      field: fieldName,
    });
  }

  if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new ApiError(400, 'invalid_input', `Invalid URL for ${fieldName}`, {
      field: fieldName,
    });
  }

  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  const normalized = parsed.toString();
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function sanitizeSocialLinks(source: unknown) {
  const socialLinksRaw = source && typeof source === 'object' ? source : {};

  return {
    linkedin: normalizeUrlValue((socialLinksRaw as any).linkedin, 'social_links.linkedin') || '',
    twitter: normalizeUrlValue((socialLinksRaw as any).twitter, 'social_links.twitter') || '',
    github: normalizeUrlValue((socialLinksRaw as any).github, 'social_links.github') || '',
    crunchbase: normalizeUrlValue((socialLinksRaw as any).crunchbase, 'social_links.crunchbase') || '',
  };
}

function sanitizeOrgInput(source) {
  return {
    name: String(source?.name || '').trim().slice(0, MAX_NAME_LENGTH),
    pseudonym: toOptionalText(source?.pseudonym, MAX_PSEUDONYM_LENGTH),
    type: toOptionalText(source?.type, MAX_TYPE_LENGTH) || 'startup',
    tagline: toOptionalText(source?.tagline, MAX_TAGLINE_LENGTH),
    industry: toOptionalText(source?.industry, MAX_INDUSTRY_LENGTH),
    location: toOptionalText(source?.location, MAX_LOCATION_LENGTH),
    website: normalizeUrlValue(source?.website, 'website'),
    bio: toOptionalText(source?.bio, MAX_BIO_LENGTH),
    isPublicDirectory: toBoolean(source?.is_public_directory),
    socialLinks: sanitizeSocialLinks(source?.social_links),
  };
}

function mapOrganizationRow(organization) {
  return {
    id: organization.id,
    name: organization.name,
    pseudonym: organization.pseudonym || '',
    type: organization.type || 'startup',
    tagline: organization.tagline || '',
    industry: organization.industry || '',
    location: organization.location || '',
    website: organization.website || '',
    bio: organization.bio || '',
    is_public_directory: Boolean(organization.isPublicDirectory),
    social_links: organization.socialLinks || {
      linkedin: '',
      twitter: '',
      github: '',
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
        tagline: input.tagline,
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
