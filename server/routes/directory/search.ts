import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
type DirectorySort = 'relevance' | 'recently_active' | 'newest' | 'az';

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function includesIgnoreCase(haystack: unknown, needle: string) {
  if (!needle) return true;
  return normalize(haystack).includes(needle);
}

function matchesQueryAcrossFields(query: string, values: unknown[]) {
  if (!query) return true;
  return values.some((value) => includesIgnoreCase(value, query));
}

function toDirectorySort(value: unknown): DirectorySort {
  const normalized = normalize(value);

  if (
    normalized === 'recently_active' ||
    normalized === 'recently-active' ||
    normalized === 'recentlyactive' ||
    normalized === 'recent'
  ) {
    return 'recently_active';
  }

  if (normalized === 'newest') {
    return 'newest';
  }

  if (
    normalized === 'az' ||
    normalized === 'a-z' ||
    normalized === 'name_asc' ||
    normalized === 'alphabetical'
  ) {
    return 'az';
  }

  return 'relevance';
}

function isVerifiedStatus(value: unknown) {
  return normalize(value) === 'verified';
}

function normalizeDateForSort(value: unknown) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compactUnique(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function toQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim();
  }

  return String(value ?? '').trim();
}

function parseNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/directory/search', async () => {
    ensureMethod(req, ['GET']);

    const db = getDb();

    const modeRaw = normalize(toQueryValue(req.query?.mode));
    const mode = modeRaw === 'people' || modeRaw === 'orgs' ? modeRaw : 'both';
    const q = normalize(toQueryValue(req.query?.q || req.query?.query || req.query?.name));
    const sort = toDirectorySort(toQueryValue(req.query?.sort || req.query?.orderBy || req.query?.order_by));

    const filters = {
      user_type: toQueryValue(req.query?.user_type),
      org_type: toQueryValue(req.query?.org_type),
      industry: toQueryValue(req.query?.industry),
      location: toQueryValue(req.query?.location),
    };

    const page = Math.max(1, Math.floor(parseNumber(toQueryValue(req.query?.page), 1)));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(parseNumber(toQueryValue(req.query?.pageSize || req.query?.page_size), DEFAULT_PAGE_SIZE))),
    );

    const shouldLoadPeople = mode === 'both' || mode === 'people';
    const shouldLoadOrgs = mode === 'both' || mode === 'orgs';

    const peopleConditions = [
      eq(schema.userProfiles.isPublicDirectory, true),
    ] as any[];

    if (filters.user_type) {
      peopleConditions.push(eq(schema.userProfiles.userType, filters.user_type));
    }

    if (filters.industry) {
      peopleConditions.push(eq(schema.userProfiles.industry, filters.industry));
    }

    if (filters.location) {
      peopleConditions.push(eq(schema.userProfiles.location, filters.location));
    }

    const orgConditions = [eq(schema.organizations.isPublicDirectory, true)] as any[];

    if (filters.org_type) {
      orgConditions.push(eq(schema.organizations.type, filters.org_type));
    }

    if (filters.industry) {
      orgConditions.push(eq(schema.organizations.industry, filters.industry));
    }

    if (filters.location) {
      orgConditions.push(eq(schema.organizations.location, filters.location));
    }

    const [peopleRows, orgRows] = await Promise.all([
      shouldLoadPeople
        ? db
            .select({
              profile: schema.userProfiles,
              user: schema.users,
            })
            .from(schema.userProfiles)
            .leftJoin(schema.users, eq(schema.users.id, schema.userProfiles.userId))
            .where(peopleConditions.length === 1 ? peopleConditions[0] : and(...peopleConditions))
        : Promise.resolve([]),
      shouldLoadOrgs
        ? db
            .select()
            .from(schema.organizations)
            .where(orgConditions.length === 1 ? orgConditions[0] : and(...orgConditions))
        : Promise.resolve([]),
    ]);

    // Public person listings always use the account full name. Profiles with no
    // full name are omitted so the directory never falls back to pseudonyms or
    // placeholder identities.
    const publicPeople = peopleRows.flatMap((row) => {
      const profile = row.profile;
      const fullName = String(row.user?.fullName || '').trim();
      const displayName = fullName;
      if (!displayName) return [];

      return [{
        kind: 'person' as const,
        id: profile.id,
        displayName,
        user_type: profile.userType || undefined,
        industry: profile.industry || undefined,
        location: profile.location || undefined,
        title: profile.title || undefined,
        tagline: profile.tagline || undefined,
        bio: profile.bio || undefined,
        website: profile.website || undefined,
        verified:
          Boolean(profile.emailVerified) ||
          Boolean(profile.documentVerified) ||
          isVerifiedStatus(profile.verificationStatus),
        lastActiveAt: row.user?.lastLoginAt || profile.updatedAt || profile.createdAt || undefined,
        updatedAt: profile.updatedAt || undefined,
        createdAt: profile.createdAt || undefined,
        _sortDate:
          normalizeDateForSort(profile.updatedAt) ||
          normalizeDateForSort(profile.createdAt),
        _sortRecentlyActive:
          normalizeDateForSort(row.user?.lastLoginAt) ||
          normalizeDateForSort(profile.updatedAt) ||
          normalizeDateForSort(profile.createdAt),
        _sortNewest: normalizeDateForSort(profile.createdAt),
        _sortName: normalize(displayName),
      }];
    });

    const publicOrgs = orgRows.map((org) => {
      const displayName = String(org.name || '').trim() || String(org.pseudonym || '').trim() || 'Organization';
      return {
        kind: 'org' as const,
        id: org.id,
        displayName,
        name: org.name || undefined,
        pseudonym: org.pseudonym || undefined,
        type: org.type || undefined,
        industry: org.industry || undefined,
        location: org.location || undefined,
        tagline: org.tagline || undefined,
        bio: org.bio || undefined,
        website: org.website || undefined,
        verified: isVerifiedStatus(org.verificationStatus),
        lastActiveAt: org.updatedAt || org.createdAt || undefined,
        updatedAt: org.updatedAt || undefined,
        createdAt: org.createdAt || undefined,
        _sortDate: normalizeDateForSort(org.updatedAt) || normalizeDateForSort(org.createdAt),
        _sortRecentlyActive: normalizeDateForSort(org.updatedAt) || normalizeDateForSort(org.createdAt),
        _sortNewest: normalizeDateForSort(org.createdAt),
        _sortName: normalize(displayName),
      };
    });

    const visiblePeople = publicPeople.filter((person) => {
      return matchesQueryAcrossFields(q, [
        person.displayName,
        person.title,
        person.tagline,
        person.bio,
        person.industry,
        person.user_type,
      ]);
    });

    const visibleOrgs = publicOrgs.filter((org) => {
      return matchesQueryAcrossFields(q, [
        org.displayName,
        org.name,
        org.pseudonym,
        org.type,
        org.tagline,
        org.bio,
        org.industry,
      ]);
    });

    const items = [...visiblePeople, ...visibleOrgs].sort((a, b) => {
      if (sort === 'recently_active') {
        if (b._sortRecentlyActive !== a._sortRecentlyActive) {
          return b._sortRecentlyActive - a._sortRecentlyActive;
        }
      } else if (sort === 'newest') {
        if (b._sortNewest !== a._sortNewest) {
          return b._sortNewest - a._sortNewest;
        }
      } else if (sort === 'az') {
        const nameDiff = a._sortName.localeCompare(b._sortName);
        if (nameDiff !== 0) return nameDiff;
      } else if (b._sortDate !== a._sortDate) {
        return b._sortDate - a._sortDate;
      }

      if (b._sortDate !== a._sortDate) return b._sortDate - a._sortDate;
      return a._sortName.localeCompare(b._sortName);
    });

    const totalCount = items.length;
    const start = (page - 1) * pageSize;
    const pagedItems = items
      .slice(start, start + pageSize)
      .map(({ _sortDate, _sortRecentlyActive, _sortNewest, _sortName, ...item }) => item);

    const facets = {
      industries: compactUnique([
        ...publicPeople.map((person) => person.industry),
        ...publicOrgs.map((org) => org.industry),
      ]),
      locations: compactUnique([
        ...publicPeople.map((person) => person.location),
        ...publicOrgs.map((org) => org.location),
      ]),
      user_types: compactUnique(publicPeople.map((person) => person.user_type)),
      org_types: compactUnique(publicOrgs.map((org) => org.type)),
    };

    ok(res, 200, {
      totalCount,
      page,
      pageSize,
      items: pagedItems,
      facets,
    });
  });
}
