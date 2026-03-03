import { and, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

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

function getOrganizationId(req: any, organizationIdParam?: string) {
  if (organizationIdParam && organizationIdParam.trim().length > 0) {
    return organizationIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
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

export default async function handler(req: any, res: any, organizationIdParam?: string) {
  await withApiRoute(req, res, '/api/account/organizations/[id]', async (context) => {
    ensureMethod(req, ['PATCH']);

    const organizationId = getOrganizationId(req, organizationIdParam);
    if (!organizationId) {
      throw new ApiError(400, 'invalid_input', 'Organization id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    const [organization] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    if (!organization) {
      throw new ApiError(404, 'organization_not_found', 'Organization not found');
    }

    const userEmail = normalizeEmail(auth.user.email);
    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, organizationId),
          or(
            eq(schema.memberships.userId, auth.user.id),
            userEmail
              ? ilike(schema.memberships.userEmail, userEmail)
              : eq(schema.memberships.userId, auth.user.id),
          ),
          eq(schema.memberships.status, 'active'),
        ),
      )
      .limit(1);

    const membershipRole = String(membership?.role || '').trim().toLowerCase();
    const canManage = auth.user.role === 'admin' || ['owner', 'admin'].includes(membershipRole);

    if (!canManage) {
      throw new ApiError(403, 'forbidden', 'Only organization admins can update this organization');
    }

    const body = await readJsonBody(req);
    const source: any =
      body.organization && typeof body.organization === 'object' ? body.organization : body;
    const updates: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(source, 'name')) {
      const name = String(source.name || '').trim().slice(0, MAX_NAME_LENGTH);
      if (!name) {
        throw new ApiError(400, 'invalid_input', 'Organization name is required');
      }
      updates.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(source, 'pseudonym')) {
      updates.pseudonym = toOptionalText(source.pseudonym, MAX_PSEUDONYM_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(source, 'type')) {
      updates.type = toOptionalText(source.type, MAX_TYPE_LENGTH) || 'startup';
    }

    if (Object.prototype.hasOwnProperty.call(source, 'tagline')) {
      updates.tagline = toOptionalText(source.tagline, MAX_TAGLINE_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(source, 'industry')) {
      updates.industry = toOptionalText(source.industry, MAX_INDUSTRY_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(source, 'location')) {
      updates.location = toOptionalText(source.location, MAX_LOCATION_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(source, 'website')) {
      updates.website = normalizeUrlValue(source.website, 'website');
    }

    if (Object.prototype.hasOwnProperty.call(source, 'bio')) {
      updates.bio = toOptionalText(source.bio, MAX_BIO_LENGTH);
    }

    if (Object.prototype.hasOwnProperty.call(source, 'is_public_directory')) {
      updates.isPublicDirectory = toBoolean(source.is_public_directory);
    }

    if (Object.prototype.hasOwnProperty.call(source, 'social_links')) {
      updates.socialLinks = sanitizeSocialLinks(source.social_links);
    }

    const [updated] = await db
      .update(schema.organizations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, organizationId))
      .returning();

    ok(res, 200, {
      organization: mapOrganizationRow(updated),
    });
  });
}
