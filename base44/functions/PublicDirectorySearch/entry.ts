import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

type Mode = 'both' | 'people' | 'orgs';

type SearchPayload = {
  mode?: Mode;
  q?: string;
  filters?: {
    user_type?: string;
    org_type?: string;
    industry?: string;
    location?: string;
  };
  page?: number;
  pageSize?: number;
};

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function includesIgnoreCase(haystack: unknown, needle: string): boolean {
  if (!needle) return true;
  return normalize(haystack).includes(needle);
}

function normalizeDateForSort(value: unknown): number {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compactUnique(values: unknown[]): string[] {
  return [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

async function loadUsersByIds(entities: any, userIds: string[]) {
  if (userIds.length === 0) return [];

  try {
    const users = await entities.User.filter({ id: { $in: userIds } });
    if (Array.isArray(users)) return users;
  } catch (_) {
    // Fall through to per-id fetch when $in is unsupported.
  }

  const cache = new Map<string, any>();
  for (const id of userIds) {
    if (cache.has(id)) continue;
    try {
      const users = await entities.User.filter({ id });
      if (users[0]) cache.set(id, users[0]);
    } catch (_) {
      // Skip failed user fetches to keep directory response resilient.
    }
  }
  return [...cache.values()];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const entities = (base44 as any).asServiceRole.entities;
    const body = (await req.json().catch(() => ({}))) as SearchPayload;

    const mode: Mode = body.mode === 'people' || body.mode === 'orgs' ? body.mode : 'both';
    const q = normalize(body.q);
    const filters = body.filters || {};
    const page = Math.max(1, Number(body.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(body.pageSize) || 20));

    const shouldLoadPeople = mode === 'both' || mode === 'people';
    const shouldLoadOrgs = mode === 'both' || mode === 'orgs';

    const peopleQuery: Record<string, unknown> = {};
    if (filters.user_type) peopleQuery.user_type = filters.user_type;
    if (filters.industry) peopleQuery.industry = filters.industry;
    if (filters.location) peopleQuery.location = filters.location;

    const orgQuery: Record<string, unknown> = { is_public_directory: true };
    if (filters.org_type) orgQuery.type = filters.org_type;
    if (filters.industry) orgQuery.industry = filters.industry;
    if (filters.location) orgQuery.location = filters.location;

    const [publicPeopleRaw, pseudonymousPeopleRaw, publicOrgsRaw] = await Promise.all([
      shouldLoadPeople ? entities.UserProfile.filter({ ...peopleQuery, privacy_mode: 'public' }) : Promise.resolve([]),
      shouldLoadPeople ? entities.UserProfile.filter({ ...peopleQuery, privacy_mode: 'pseudonymous' }) : Promise.resolve([]),
      shouldLoadOrgs ? entities.Organization.filter(orgQuery) : Promise.resolve([]),
    ]);
    const publicPeopleById = new Map<string, any>();
    for (const profile of [...(publicPeopleRaw as any[]), ...(pseudonymousPeopleRaw as any[])]) {
      if (profile?.id) publicPeopleById.set(String(profile.id), profile);
    }
    const publicPeople = [...publicPeopleById.values()];
    const publicOrgs = publicOrgsRaw as any[];

    const userIds = [...new Set(publicPeople.map((profile) => String(profile.user_id ?? '')).filter(Boolean))];
    const users = shouldLoadPeople ? await loadUsersByIds(entities, userIds) : [];
    const userNameById = new Map<string, string>(
      users.map((user: any) => [String(user.id), String(user.full_name ?? '').trim()]),
    );

    const visiblePeople = publicPeople
      .filter((profile) => {
        if (filters.user_type && normalize(profile.user_type) !== normalize(filters.user_type)) return false;
        if (filters.industry && normalize(profile.industry) !== normalize(filters.industry)) return false;
        if (filters.location && normalize(profile.location) !== normalize(filters.location)) return false;

        const fullName = userNameById.get(String(profile.user_id)) || '';
        const pseudonym = String(profile.pseudonym ?? '');
        return includesIgnoreCase(fullName, q) || includesIgnoreCase(pseudonym, q);
      })
      .map((profile) => {
        const privacyMode = String(profile.privacy_mode ?? '').toLowerCase();
        const fullName = userNameById.get(String(profile.user_id)) || '';
        const pseudonym = String(profile.pseudonym ?? '').trim();

        let displayName = '';
        if (privacyMode === 'public') {
          displayName = fullName || pseudonym || 'Anonymous User';
        } else {
          displayName = pseudonym || 'Anonymous User';
        }

        return {
          kind: 'person' as const,
          id: profile.id,
          displayName,
          pseudonym: pseudonym || undefined,
          privacy_mode: privacyMode || undefined,
          user_type: profile.user_type || undefined,
          industry: profile.industry || undefined,
          location: profile.location || undefined,
          title: profile.title || undefined,
          bio: profile.bio || undefined,
          website: profile.website || undefined,
          _sortDate:
            normalizeDateForSort(profile.updated_date) ||
            normalizeDateForSort(profile.updatedAt) ||
            normalizeDateForSort(profile.created_date) ||
            normalizeDateForSort(profile.createdAt),
          _sortName: normalize(displayName),
        };
      });

    const visibleOrgs = publicOrgs
      .filter((org) => {
        if (filters.org_type && normalize(org.type) !== normalize(filters.org_type)) return false;
        if (filters.industry && normalize(org.industry) !== normalize(filters.industry)) return false;
        if (filters.location && normalize(org.location) !== normalize(filters.location)) return false;

        return includesIgnoreCase(org.name, q) || includesIgnoreCase(org.pseudonym, q);
      })
      .map((org) => {
        const displayName = String(org.name ?? '').trim() || String(org.pseudonym ?? '').trim() || 'Organization';
        return {
          kind: 'org' as const,
          id: org.id,
          displayName,
          name: org.name || undefined,
          pseudonym: org.pseudonym || undefined,
          type: org.type || undefined,
          industry: org.industry || undefined,
          location: org.location || undefined,
          bio: org.bio || undefined,
          website: org.website || undefined,
          _sortDate:
            normalizeDateForSort(org.updated_date) ||
            normalizeDateForSort(org.updatedAt) ||
            normalizeDateForSort(org.created_date) ||
            normalizeDateForSort(org.createdAt),
          _sortName: normalize(displayName),
        };
      });

    const items = [...visiblePeople, ...visibleOrgs].sort((a, b) => {
      if (b._sortDate !== a._sortDate) return b._sortDate - a._sortDate;
      return a._sortName.localeCompare(b._sortName);
    });

    const totalCount = items.length;
    const start = (page - 1) * pageSize;
    const pagedItems = items.slice(start, start + pageSize).map(({ _sortDate, _sortName, ...item }) => item);

    const facets = {
      industries: compactUnique([...publicPeople.map((p) => p.industry), ...publicOrgs.map((o) => o.industry)]),
      locations: compactUnique([...publicPeople.map((p) => p.location), ...publicOrgs.map((o) => o.location)]),
      user_types: compactUnique(publicPeople.map((p) => p.user_type)),
      org_types: compactUnique(publicOrgs.map((o) => o.type)),
    };

    return Response.json({
      ok: true,
      totalCount,
      page,
      pageSize,
      items: pagedItems,
      facets,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json(
      {
        ok: false,
        error: err.message,
      },
      { status: 500 },
    );
  }
});
