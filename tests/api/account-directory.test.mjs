import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import profileHandler from '../../server/routes/account/profile.ts';
import organizationsHandler from '../../server/routes/account/organizations.ts';
import organizationByIdHandler from '../../server/routes/account/organizations/[id].ts';
import emailConfigStatusHandler from '../../server/routes/account/email-config-status.ts';
import directorySearchHandler from '../../server/routes/directory/search.ts';
import directoryDetailHandler from '../../server/routes/directory/detail.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function getCookie(subject, email) {
  return makeSessionCookie({ sub: subject, email });
}

async function callHandler(handler, reqOptions) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res);
  return res;
}

if (!hasDatabaseUrl()) {
  test('account + directory API parity (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('profile GET/PUT persists profile (including tagline) + notification settings and writes consent audit logs', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = getCookie('account_profile_user', 'owner@example.com');

    const getInitialRes = await callHandler(profileHandler, {
      method: 'GET',
      url: '/api/account/profile',
      headers: { cookie },
    });
    assert.equal(getInitialRes.statusCode, 200);
    assert.equal(getInitialRes.jsonBody().profile, null);

    const putRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          pseudonym: 'FounderOne',
          user_type: 'business',
          title: 'CEO',
          tagline: 'Helping growth-stage teams validate enterprise demand',
          industry: 'Technology',
          location: 'New York',
          bio: 'Building in public.',
          website: 'https://example.com',
          privacy_mode: 'public',
          social_links: {
            linkedin: 'https://linkedin.com/in/founder',
            github: 'https://github.com/founder',
            twitter: 'https://x.com/founder',
            crunchbase: 'https://crunchbase.com/person/founder',
          },
          social_links_ai_consent: true,
        },
      },
    });

    assert.equal(putRes.statusCode, 200);
    const savedProfile = putRes.jsonBody().profile;
    assert.equal(savedProfile.pseudonym, 'FounderOne');
    assert.equal(savedProfile.user_type, 'business');
    assert.equal(savedProfile.tagline, 'Helping growth-stage teams validate enterprise demand');
    assert.equal(savedProfile.privacy_mode, 'public');
    assert.equal(savedProfile.social_links_ai_consent, true);

    const putNotificationsRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          notification_settings: {
            email_proposals: false,
            email_evaluations: true,
            email_reveals: false,
            email_marketing: true,
          },
        },
      },
    });

    assert.equal(putNotificationsRes.statusCode, 200);

    const getAfterRes = await callHandler(profileHandler, {
      method: 'GET',
      url: '/api/account/profile',
      headers: { cookie },
    });

    assert.equal(getAfterRes.statusCode, 200);
    const profile = getAfterRes.jsonBody().profile;
    assert.equal(profile.notification_settings.email_proposals, false);
    assert.equal(profile.notification_settings.email_marketing, true);
    assert.equal(profile.tagline, 'Helping growth-stage teams validate enterprise demand');

    const oversizeTaglineRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          tagline: 'x'.repeat(140),
        },
      },
    });
    assert.equal(oversizeTaglineRes.statusCode, 200);
    assert.equal(oversizeTaglineRes.jsonBody().profile.tagline.length, 80);

    const toggleConsentRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          social_links_ai_consent: false,
        },
      },
    });
    assert.equal(toggleConsentRes.statusCode, 200);

    const db = getDb();
    const auditRows = await db.execute(
      sql`select count(*)::int as count from audit_logs where entity_type = 'UserProfile' and action = 'consent_change'`,
    );
    assert.equal(Number(auditRows.rows?.[0]?.count || 0) >= 1, true);
  });

  test('organization create/list/update enforce owner permission', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = getCookie('account_org_owner', 'owner@example.com');
    const otherCookie = getCookie('account_org_other', 'other@example.com');

    const createRes = await callHandler(organizationsHandler, {
      method: 'POST',
      url: '/api/account/organizations',
      headers: { cookie: ownerCookie },
      body: {
        organization: {
          name: 'Acme Corp',
          type: 'startup',
          industry: 'Technology',
          location: 'SF',
          website: 'acme.com',
          tagline: 'Enterprise onboarding automation for regulated teams',
          social_links: {
            linkedin: 'linkedin.com/company/acme',
            github: 'github.com/acme',
            twitter: 'x.com/acme',
            crunchbase: 'crunchbase.com/organization/acme',
          },
          is_public_directory: false,
        },
      },
    });

    assert.equal(createRes.statusCode, 201);
    const createdOrg = createRes.jsonBody().organization;
    assert.equal(createdOrg.name, 'Acme Corp');
    assert.equal(createdOrg.website, 'https://acme.com');
    assert.equal(createdOrg.tagline, 'Enterprise onboarding automation for regulated teams');
    assert.equal(createdOrg.social_links.github, 'https://github.com/acme');

    const listRes = await callHandler(organizationsHandler, {
      method: 'GET',
      url: '/api/account/organizations',
      headers: { cookie: ownerCookie },
    });
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.jsonBody().organizations.length, 1);
    assert.equal(listRes.jsonBody().memberships[0].role, 'owner');

    const forbiddenUpdateRes = await callHandler(organizationByIdHandler, {
      method: 'PATCH',
      url: `/api/account/organizations/${createdOrg.id}`,
      query: { id: createdOrg.id },
      headers: { cookie: otherCookie },
      body: {
        organization: {
          name: 'Hacked Name',
        },
      },
    });
    assert.equal(forbiddenUpdateRes.statusCode, 403);

    const updateRes = await callHandler(organizationByIdHandler, {
      method: 'PATCH',
      url: `/api/account/organizations/${createdOrg.id}`,
      query: { id: createdOrg.id },
      headers: { cookie: ownerCookie },
      body: {
        organization: {
          name: 'Acme Corp Updated',
          website: 'http://acme-updated.com',
          tagline: 'Trusted partner for enterprise readiness',
          social_links: {
            linkedin: 'https://linkedin.com/company/acme-updated',
            github: 'https://github.com/acme-updated',
            twitter: 'https://x.com/acme-updated',
            crunchbase: 'https://crunchbase.com/organization/acme-updated',
          },
          is_public_directory: true,
        },
      },
    });

    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.jsonBody().organization.name, 'Acme Corp Updated');
    assert.equal(updateRes.jsonBody().organization.website, 'https://acme-updated.com');
    assert.equal(updateRes.jsonBody().organization.tagline, 'Trusted partner for enterprise readiness');
    assert.equal(updateRes.jsonBody().organization.social_links.github, 'https://github.com/acme-updated');
    assert.equal(updateRes.jsonBody().organization.is_public_directory, true);

    const invalidLinkUpdateRes = await callHandler(organizationByIdHandler, {
      method: 'PATCH',
      url: `/api/account/organizations/${createdOrg.id}`,
      query: { id: createdOrg.id },
      headers: { cookie: ownerCookie },
      body: {
        organization: {
          social_links: {
            linkedin: 'not a valid url',
          },
        },
      },
    });
    assert.equal(invalidLinkUpdateRes.statusCode, 400);
    assert.equal(invalidLinkUpdateRes.jsonBody().error?.field, 'social_links.linkedin');
  });

  test('directory search/detail returns public people/org entries and hides private profiles', async () => {
    await ensureMigrated();
    await resetTables();

    const publicCookie = getCookie('directory_public_user', 'public@example.com');
    const privateCookie = getCookie('directory_private_user', 'private@example.com');

    const publicProfileRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie: publicCookie },
      body: {
        profile: {
          pseudonym: 'PublicAlias',
          user_type: 'business',
          industry: 'Technology',
          location: 'NYC',
          title: 'Founder',
          tagline: 'Helping founders secure better pilot partners',
          bio: 'Public bio',
          website: 'https://public.example.com',
          privacy_mode: 'public',
          is_public_directory: true,
        },
      },
    });
    assert.equal(publicProfileRes.statusCode, 200);
    const publicProfileId = publicProfileRes.jsonBody().profile.id;

    const privateProfileRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie: privateCookie },
      body: {
        profile: {
          pseudonym: 'PrivateAlias',
          privacy_mode: 'private',
        },
      },
    });
    assert.equal(privateProfileRes.statusCode, 200);
    const privateProfileId = privateProfileRes.jsonBody().profile.id;

    const createOrgRes = await callHandler(organizationsHandler, {
      method: 'POST',
      url: '/api/account/organizations',
      headers: { cookie: publicCookie },
      body: {
        organization: {
          name: 'Public Org',
          industry: 'Technology',
          location: 'NYC',
          tagline: 'Fast enterprise onboarding for partner ecosystems',
          is_public_directory: true,
        },
      },
    });
    assert.equal(createOrgRes.statusCode, 201);
    const publicOrgId = createOrgRes.jsonBody().organization.id;

    const createPrivateOrgRes = await callHandler(organizationsHandler, {
      method: 'POST',
      url: '/api/account/organizations',
      headers: { cookie: publicCookie },
      body: {
        organization: {
          name: 'Private Org',
          industry: 'Technology',
          location: 'NYC',
          tagline: 'Internal only listing',
          is_public_directory: false,
        },
      },
    });
    assert.equal(createPrivateOrgRes.statusCode, 201);
    const privateOrgId = createPrivateOrgRes.jsonBody().organization.id;

    const searchRes = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'both', q: 'Public', page: '1', pageSize: '20' },
    });

    assert.equal(searchRes.statusCode, 200);
    const searchPayload = searchRes.jsonBody();
    assert.equal(searchPayload.items.some((item) => item.kind === 'person' && item.id === publicProfileId), true);
    assert.equal(searchPayload.items.some((item) => item.kind === 'org' && item.id === publicOrgId), true);
    assert.equal(searchPayload.items.some((item) => item.kind === 'org' && item.id === privateOrgId), false);
    const publicPerson = searchPayload.items.find((item) => item.kind === 'person' && item.id === publicProfileId);
    assert.equal(publicPerson?.tagline, 'Helping founders secure better pilot partners');
    const publicOrg = searchPayload.items.find((item) => item.kind === 'org' && item.id === publicOrgId);
    assert.equal(publicOrg?.tagline, 'Fast enterprise onboarding for partner ecosystems');

    const personDetailRes = await callHandler(directoryDetailHandler, {
      method: 'GET',
      url: '/api/directory/detail',
      query: { kind: 'person', id: publicProfileId },
    });
    assert.equal(personDetailRes.statusCode, 200);
    assert.equal(personDetailRes.jsonBody().item.kind, 'person');
    assert.equal(personDetailRes.jsonBody().item.tagline, 'Helping founders secure better pilot partners');

    const orgDetailRes = await callHandler(directoryDetailHandler, {
      method: 'GET',
      url: '/api/directory/detail',
      query: { kind: 'org', id: publicOrgId },
    });
    assert.equal(orgDetailRes.statusCode, 200);
    assert.equal(orgDetailRes.jsonBody().item.kind, 'org');
    assert.equal(orgDetailRes.jsonBody().item.tagline, 'Fast enterprise onboarding for partner ecosystems');

    const privateDetailRes = await callHandler(directoryDetailHandler, {
      method: 'GET',
      url: '/api/directory/detail',
      query: { kind: 'person', id: privateProfileId },
    });
    assert.equal(privateDetailRes.statusCode, 404);

    const privateOrgDetailRes = await callHandler(directoryDetailHandler, {
      method: 'GET',
      url: '/api/directory/detail',
      query: { kind: 'org', id: privateOrgId },
    });
    assert.equal(privateOrgDetailRes.statusCode, 404);
  });

  test('email config status requires admin role and returns config details for admins', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = getCookie('email_config_user', 'adminish@example.com');

    const forbiddenRes = await callHandler(emailConfigStatusHandler, {
      method: 'GET',
      url: '/api/account/email-config-status',
      headers: { cookie },
    });
    assert.equal(forbiddenRes.statusCode, 403);

    const db = getDb();
    await db.execute(sql`update users set role = 'admin' where id = 'email_config_user'`);

    process.env.RESEND_API_KEY = 'test_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

    const successRes = await callHandler(emailConfigStatusHandler, {
      method: 'GET',
      url: '/api/account/email-config-status',
      headers: { cookie },
    });

    assert.equal(successRes.statusCode, 200);
    const body = successRes.jsonBody();
    assert.equal(body.hasResendKey, true);
    assert.equal(body.fromDomain, 'mail.getpremarket.com');
    assert.equal(body.isValidConfig, true);
  });

  // ── Profile public-directory opt-in tests ───────────────────────────────

  test('profile is private by default – does not appear in directory without explicit opt-in', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = getCookie('dir_default_user', 'default@example.com');

    // Create profile WITHOUT setting is_public_directory
    const saveRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          pseudonym: 'DefaultAlias',
          privacy_mode: 'public',
          industry: 'Technology',
          tagline: 'Should not appear in directory',
        },
      },
    });
    assert.equal(saveRes.statusCode, 200);
    const profileId = saveRes.jsonBody().profile.id;

    // is_public_directory should be false by default
    assert.equal(saveRes.jsonBody().profile.is_public_directory, false);

    // Directory search must NOT include this profile
    const searchRes = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'people', page: '1', pageSize: '50' },
    });
    assert.equal(searchRes.statusCode, 200);
    const ids = searchRes.jsonBody().items.map((i) => i.id);
    assert.equal(ids.includes(profileId), false, 'default profile must not appear in directory');
  });

  test('profile appears in directory only after explicit opt-in and disappears after opt-out', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = getCookie('dir_optin_user', 'optin@example.com');

    // Step 1: create profile, opt-out
    const createRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          pseudonym: 'OptInAlias',
          privacy_mode: 'public',
          industry: 'SaaS',
          location: 'Austin',
          tagline: 'Opt-in test profile',
          is_public_directory: false,
        },
      },
    });
    assert.equal(createRes.statusCode, 200);
    const profileId = createRes.jsonBody().profile.id;

    const searchBefore = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'people', page: '1', pageSize: '50' },
    });
    assert.equal(searchBefore.jsonBody().items.some((i) => i.id === profileId), false,
      'profile must not appear before opt-in');

    // Step 2: opt-in
    const optInRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: { profile: { is_public_directory: true } },
    });
    assert.equal(optInRes.statusCode, 200);
    assert.equal(optInRes.jsonBody().profile.is_public_directory, true);

    const searchAfterOptIn = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'people', page: '1', pageSize: '50' },
    });
    assert.equal(searchAfterOptIn.jsonBody().items.some((i) => i.id === profileId), true,
      'profile must appear after opt-in');

    // Step 3: opt-out
    const optOutRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: { profile: { is_public_directory: false } },
    });
    assert.equal(optOutRes.statusCode, 200);
    assert.equal(optOutRes.jsonBody().profile.is_public_directory, false);

    const searchAfterOptOut = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'people', page: '1', pageSize: '50' },
    });
    assert.equal(searchAfterOptOut.jsonBody().items.some((i) => i.id === profileId), false,
      'profile must not appear after opt-out');
  });

  test('no "Anonymous User" entries appear in public directory search results', async () => {
    await ensureMigrated();
    await resetTables();

    // Create a profile opted-in but with NO pseudonym and no full_name
    // – the API-level user has no fullName because we're using raw session cookies.
    const cookie = getCookie('dir_anon_user', 'anon@example.com');
    const saveRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie },
      body: {
        profile: {
          // no pseudonym, privacy_mode public but no name
          privacy_mode: 'pseudonymous',
          is_public_directory: true,
          industry: 'Technology',
        },
      },
    });
    assert.equal(saveRes.statusCode, 200);

    const searchRes = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'people', page: '1', pageSize: '50' },
    });
    assert.equal(searchRes.statusCode, 200);
    const displayNames = searchRes.jsonBody().items.map((i) => i.displayName);
    assert.equal(
      displayNames.includes('Anonymous User'),
      false,
      '"Anonymous User" must never appear in directory results',
    );
  });

  test('organization public-directory toggle still works correctly', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = getCookie('dir_org_owner', 'orgowner@example.com');

    const createRes = await callHandler(organizationsHandler, {
      method: 'POST',
      url: '/api/account/organizations',
      headers: { cookie },
      body: {
        organization: {
          name: 'Org Directory Test',
          industry: 'FinTech',
          location: 'London',
          tagline: 'Org parity test',
          is_public_directory: false,
        },
      },
    });
    assert.equal(createRes.statusCode, 201);
    const orgId = createRes.jsonBody().organization.id;

    const searchBefore = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'orgs', page: '1', pageSize: '50' },
    });
    assert.equal(searchBefore.jsonBody().items.some((i) => i.id === orgId), false,
      'org must not appear when is_public_directory=false');

    await callHandler(organizationByIdHandler, {
      method: 'PATCH',
      url: `/api/account/organizations/${orgId}`,
      query: { id: orgId },
      headers: { cookie },
      body: { organization: { is_public_directory: true } },
    });

    const searchAfter = await callHandler(directorySearchHandler, {
      method: 'GET',
      url: '/api/directory/search',
      query: { mode: 'orgs', page: '1', pageSize: '50' },
    });
    assert.equal(searchAfter.jsonBody().items.some((i) => i.id === orgId), true,
      'org must appear after is_public_directory=true');
  });
}
