import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function toQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim();
  }

  return String(value ?? '').trim();
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/directory/detail', async () => {
    ensureMethod(req, ['GET']);

    const kind = normalize(toQueryValue(req.query?.kind));
    const id = toQueryValue(req.query?.id);

    if (!kind || !id) {
      throw new ApiError(400, 'invalid_input', 'kind and id are required');
    }

    const db = getDb();

    if (kind === 'person') {
      const [row] = await db
        .select({
          profile: schema.userProfiles,
          user: schema.users,
        })
        .from(schema.userProfiles)
        .leftJoin(schema.users, eq(schema.users.id, schema.userProfiles.userId))
        .where(eq(schema.userProfiles.id, id))
        .limit(1);

      if (!row?.profile) {
        throw new ApiError(404, 'not_found', 'Not found');
      }

      const privacyMode = normalize(row.profile.privacyMode);
      if (privacyMode === 'private') {
        throw new ApiError(404, 'not_found', 'Not found');
      }

      const fullName = String(row.user?.fullName || '').trim();
      const pseudonym = String(row.profile.pseudonym || '').trim();
      const displayName =
        privacyMode === 'public' ? fullName || pseudonym || 'Anonymous User' : pseudonym || 'Anonymous User';

      ok(res, 200, {
        item: {
          kind: 'person',
          id: row.profile.id,
          displayName,
          pseudonym: pseudonym || undefined,
          privacy_mode: privacyMode || undefined,
          user_type: row.profile.userType || undefined,
          industry: row.profile.industry || undefined,
          location: row.profile.location || undefined,
          title: row.profile.title || undefined,
          tagline: row.profile.tagline || undefined,
          bio: row.profile.bio || undefined,
          website: row.profile.website || undefined,
        },
      });
      return;
    }

    if (kind === 'org') {
      const [organization] = await db
        .select()
        .from(schema.organizations)
        .where(and(eq(schema.organizations.id, id), eq(schema.organizations.isPublicDirectory, true)))
        .limit(1);

      if (!organization) {
        throw new ApiError(404, 'not_found', 'Not found');
      }

      const displayName =
        String(organization.name || '').trim() ||
        String(organization.pseudonym || '').trim() ||
        'Organization';

      ok(res, 200, {
        item: {
          kind: 'org',
          id: organization.id,
          displayName,
          name: organization.name || undefined,
          pseudonym: organization.pseudonym || undefined,
          type: organization.type || undefined,
          industry: organization.industry || undefined,
          location: organization.location || undefined,
          bio: organization.bio || undefined,
          website: organization.website || undefined,
        },
      });
      return;
    }

    throw new ApiError(404, 'not_found', 'Not found');
  });
}
