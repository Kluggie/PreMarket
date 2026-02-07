import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

type DetailPayload = {
  kind?: 'person' | 'org';
  id?: string;
};

function notFound() {
  return Response.json(
    {
      ok: false,
      error: 'Not found',
    },
    { status: 404 },
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as DetailPayload;

    const kind = body.kind;
    const id = String(body.id ?? '').trim();

    if (!kind || !id) {
      return Response.json(
        {
          ok: false,
          error: 'kind and id are required',
        },
        { status: 400 },
      );
    }

    if (kind === 'person') {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ id });
      const profile = profiles[0];
      if (!profile) return notFound();

      const privacyMode = String(profile.privacy_mode ?? '').toLowerCase();
      if (privacyMode === 'private') return notFound();

      let fullName = '';
      if (profile.user_id) {
        const users = await base44.asServiceRole.entities.User.filter({ id: profile.user_id });
        fullName = String(users[0]?.full_name ?? '').trim();
      }

      const pseudonym = String(profile.pseudonym ?? '').trim();
      const displayName =
        privacyMode === 'public' ? fullName || pseudonym || 'Anonymous User' : pseudonym || 'Anonymous User';

      return Response.json({
        ok: true,
        item: {
          kind: 'person',
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
        },
      });
    }

    if (kind === 'org') {
      const orgs = await base44.asServiceRole.entities.Organization.filter({ id });
      const org = orgs[0];
      if (!org) return notFound();
      if (!Boolean(org.is_public_directory)) return notFound();

      const displayName = String(org.name ?? '').trim() || String(org.pseudonym ?? '').trim() || 'Organization';

      return Response.json({
        ok: true,
        item: {
          kind: 'org',
          id: org.id,
          displayName,
          name: org.name || undefined,
          pseudonym: org.pseudonym || undefined,
          type: org.type || undefined,
          industry: org.industry || undefined,
          location: org.location || undefined,
          bio: org.bio || undefined,
          website: org.website || undefined,
        },
      });
    }

    return notFound();
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
