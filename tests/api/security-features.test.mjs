import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import sessionsHandler from '../../server/routes/security/sessions.ts';
import revokeSessionHandler from '../../server/routes/security/sessions/revoke.ts';
import revokeAllSessionsHandler from '../../server/routes/security/sessions/revoke-all.ts';
import mfaStatusHandler from '../../server/routes/security/mfa/status.ts';
import mfaEnrollStartHandler from '../../server/routes/security/mfa/enroll/start.ts';
import mfaEnrollConfirmHandler from '../../server/routes/security/mfa/enroll/confirm.ts';
import mfaChallengeHandler from '../../server/routes/security/mfa/challenge.ts';
import mfaDisableHandler from '../../server/routes/security/mfa/disable.ts';
import logoutHandler from '../../server/routes/auth/logout.ts';
import securityActivityHandler from '../../server/routes/security/activity.ts';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { generateCurrentTotpCode } from '../../server/_lib/mfa.ts';

ensureTestEnv();

async function callRoute(handler, { method = 'GET', url = '/', query = {}, headers = {}, body = {} } = {}, ...args) {
  const req = createMockReq({
    method,
    url,
    query,
    headers,
    body,
  });
  const res = createMockRes();
  await handler(req, res, ...args);
  return res;
}

async function seedUser(userId, email) {
  const db = getDb();
  await db.execute(sql`
    insert into users (id, email, full_name, role, created_at, updated_at)
    values (${userId}, ${email}, 'Test User', 'user', now(), now())
    on conflict (id) do update set email = excluded.email, updated_at = now()
  `);
}

async function seedVerifiedProfile(userId, email) {
  const db = getDb();
  await db.execute(sql`
    insert into user_profiles (id, user_id, user_email, email_verified, verification_status, created_at, updated_at)
    values (${`profile_${userId}`}, ${userId}, ${email}, true, 'verified', now(), now())
    on conflict (user_id) do update
    set user_email = excluded.user_email,
        email_verified = true,
        verification_status = 'verified',
        updated_at = now()
  `);
}

async function seedSession(sessionId, userId, minutesAgo = 0) {
  const db = getDb();
  await db.execute(sql`
    insert into auth_sessions (id, user_id, created_at, last_seen_at, revoked_at, ip_hash, user_agent, mfa_passed_at)
    values (
      ${sessionId},
      ${userId},
      now() - make_interval(mins => ${minutesAgo}),
      now() - make_interval(mins => ${minutesAgo}),
      null,
      ${`hash_${sessionId}`},
      ${`UA ${sessionId}`},
      now()
    )
    on conflict (id) do update
    set user_id = excluded.user_id,
        created_at = excluded.created_at,
        last_seen_at = excluded.last_seen_at,
        revoked_at = null,
        mfa_passed_at = excluded.mfa_passed_at
  `);
}

function sessionCookie({ userId, email, sid, mfaRequired = false, mfaPassed = true }) {
  return makeSessionCookie({
    sub: userId,
    email,
    sid,
    mfa_required: mfaRequired,
    mfa_passed: mfaPassed,
  });
}

const dbAvailable = hasDatabaseUrl();

test(
  'security feature API suite (skipped: DATABASE_URL missing)',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async (t) => {
    await ensureMigrated();

    await t.test('sessions list includes current session', async () => {
      await resetTables();
      const userId = 'security_sessions_user';
      const email = 'security-sessions@example.com';
      await seedUser(userId, email);
      await seedSession('sess_current', userId, 0);
      await seedSession('sess_other', userId, 5);

      const res = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: 'sess_current',
          }),
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.jsonBody();
      assert.equal(Array.isArray(body.sessions), true);
      const current = body.sessions.find((entry) => entry.id === 'sess_current');
      assert.ok(current, 'current session should be listed');
      assert.equal(Boolean(current.is_current || current.isCurrent), true);
    });

    await t.test('revoke single session works and forbids revoking other users', async () => {
      await resetTables();
      const userId = 'security_revoke_user';
      const email = 'security-revoke@example.com';
      const otherUserId = 'security_revoke_other';
      await seedUser(userId, email);
      await seedUser(otherUserId, 'security-other@example.com');
      await seedSession('sess_current', userId, 0);
      await seedSession('sess_target', userId, 2);
      await seedSession('sess_other_user', otherUserId, 3);

      const ownRes = await callRoute(revokeSessionHandler, {
        method: 'POST',
        url: '/api/security/sessions/revoke',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {
          sessionId: 'sess_target',
        },
      });
      assert.equal(ownRes.statusCode, 200);

      const otherRes = await callRoute(revokeSessionHandler, {
        method: 'POST',
        url: '/api/security/sessions/revoke',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {
          sessionId: 'sess_other_user',
        },
      });
      assert.equal(otherRes.statusCode, 404);
    });

    await t.test('revoke-all signs out other sessions and keeps current', async () => {
      await resetTables();
      const userId = 'security_revoke_all_user';
      const email = 'security-revoke-all@example.com';
      await seedUser(userId, email);
      await seedSession('sess_current', userId, 0);
      await seedSession('sess_other_1', userId, 10);
      await seedSession('sess_other_2', userId, 20);

      const res = await callRoute(revokeAllSessionsHandler, {
        method: 'POST',
        url: '/api/security/sessions/revoke-all',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {},
      });

      assert.equal(res.statusCode, 200);
      const body = res.jsonBody();
      assert.equal(body.revoked_count, 2);
      assert.equal(Boolean(body.signed_out), false);

      const db = getDb();
      const rows = await db.execute(sql`
        select id, revoked_at is not null as revoked
        from auth_sessions
        where user_id = ${userId}
        order by id
      `);
      const state = Object.fromEntries(rows.rows.map((row) => [String(row.id), Boolean(row.revoked)]));
      assert.equal(state.sess_current, false);
      assert.equal(state.sess_other_1, true);
      assert.equal(state.sess_other_2, true);
    });

    await t.test('audit events are written for revoke and logout actions', async () => {
      await resetTables();
      const userId = 'security_audit_user';
      const email = 'security-audit@example.com';
      await seedUser(userId, email);
      await seedSession('sess_current', userId, 0);
      await seedSession('sess_target', userId, 4);

      await callRoute(revokeSessionHandler, {
        method: 'POST',
        url: '/api/security/sessions/revoke',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {
          sessionId: 'sess_target',
        },
      });

      await callRoute(revokeAllSessionsHandler, {
        method: 'POST',
        url: '/api/security/sessions/revoke-all',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {},
      });

      await callRoute(logoutHandler, {
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {},
      });

      const db = getDb();
      const eventRows = await db.execute(sql`
        select event_type
        from audit_events
        where user_id = ${userId}
      `);
      const eventTypes = new Set(eventRows.rows.map((row) => String(row.event_type)));
      assert.equal(eventTypes.has('auth.session.revoked'), true);
      assert.equal(eventTypes.has('auth.sessions.revoked_all'), true);
      assert.equal(eventTypes.has('auth.logout'), true);
    });

    await t.test('security activity endpoint returns recent events', async () => {
      await resetTables();
      const userId = 'security_activity_user';
      const email = 'security-activity@example.com';
      await seedUser(userId, email);
      await seedSession('sess_current', userId, 0);

      const db = getDb();
      await db.execute(sql`
        insert into audit_events (id, user_id, event_type, created_at, metadata)
        values
          (${`audit_evt_${userId}_1`}, ${userId}, 'auth.login.success', now(), '{}'::jsonb),
          (${`audit_evt_${userId}_2`}, ${userId}, 'auth.logout', now(), '{}'::jsonb)
      `);

      const res = await callRoute(securityActivityHandler, {
        method: 'GET',
        url: '/api/security/activity',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        query: {
          limit: 20,
        },
      });

      assert.equal(res.statusCode, 200);
      const events = res.jsonBody().events || [];
      assert.equal(Array.isArray(events), true);
      assert.equal(events.length >= 2, true);
      const types = new Set(events.map((entry) => entry.event_type));
      assert.equal(types.has('auth.login.success'), true);
      assert.equal(types.has('auth.logout'), true);
    });

    await t.test('MFA enrollment requires verified user', async () => {
      await resetTables();
      const userId = 'security_mfa_verified_gate_user';
      const email = 'security-mfa-verified-gate@example.com';
      await seedUser(userId, email);
      await seedSession('sess_current', userId, 0);

      const unverifiedRes = await callRoute(mfaEnrollStartHandler, {
        method: 'POST',
        url: '/api/security/mfa/enroll/start',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {},
      });
      assert.equal(unverifiedRes.statusCode, 403);

      await seedVerifiedProfile(userId, email);

      const verifiedRes = await callRoute(mfaEnrollStartHandler, {
        method: 'POST',
        url: '/api/security/mfa/enroll/start',
        headers: {
          cookie: sessionCookie({ userId, email, sid: 'sess_current' }),
        },
        body: {},
      });
      assert.equal(verifiedRes.statusCode, 200);
      const enrollment = verifiedRes.jsonBody().enrollment;
      assert.equal(typeof enrollment.secret, 'string');
      assert.equal(typeof enrollment.otpauth_uri, 'string');
    });

    await t.test('MFA enable/disable and backup one-time use with login challenge gate', async () => {
      await resetTables();
      const userId = 'security_mfa_flow_user';
      const email = 'security-mfa-flow@example.com';
      await seedUser(userId, email);
      await seedVerifiedProfile(userId, email);
      await seedSession('sess_current', userId, 0);

      const primaryCookie = sessionCookie({ userId, email, sid: 'sess_current' });

      const enrollStartRes = await callRoute(mfaEnrollStartHandler, {
        method: 'POST',
        url: '/api/security/mfa/enroll/start',
        headers: { cookie: primaryCookie },
        body: {},
      });
      assert.equal(enrollStartRes.statusCode, 200);
      const secret = enrollStartRes.jsonBody().enrollment.secret;
      const enrollmentCode = generateCurrentTotpCode(secret);

      const enrollConfirmRes = await callRoute(mfaEnrollConfirmHandler, {
        method: 'POST',
        url: '/api/security/mfa/enroll/confirm',
        headers: { cookie: primaryCookie },
        body: {
          code: enrollmentCode,
        },
      });
      assert.equal(enrollConfirmRes.statusCode, 200);
      const backupCodes = enrollConfirmRes.jsonBody().backup_codes;
      assert.equal(Array.isArray(backupCodes), true);
      assert.equal(backupCodes.length >= 8, true);

      await seedSession('sess_pending_1', userId, 0);
      const pendingCookie1 = sessionCookie({
        userId,
        email,
        sid: 'sess_pending_1',
        mfaRequired: true,
        mfaPassed: false,
      });

      const blockedRes = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: pendingCookie1,
        },
      });
      assert.equal(blockedRes.statusCode, 401);
      assert.equal(blockedRes.jsonBody().error?.code, 'mfa_required');

      const statusRes = await callRoute(mfaStatusHandler, {
        method: 'GET',
        url: '/api/security/mfa/status',
        headers: {
          cookie: pendingCookie1,
        },
      });
      assert.equal(statusRes.statusCode, 200);
      assert.equal(Boolean(statusRes.jsonBody().mfa.requires_challenge), true);

      const challengeSuccessRes = await callRoute(mfaChallengeHandler, {
        method: 'POST',
        url: '/api/security/mfa/challenge',
        headers: {
          cookie: pendingCookie1,
        },
        body: {
          codeOrBackup: backupCodes[0],
        },
      });
      assert.equal(challengeSuccessRes.statusCode, 200);

      await seedSession('sess_pending_2', userId, 0);
      const pendingCookie2 = sessionCookie({
        userId,
        email,
        sid: 'sess_pending_2',
        mfaRequired: true,
        mfaPassed: false,
      });
      const challengeReuseRes = await callRoute(mfaChallengeHandler, {
        method: 'POST',
        url: '/api/security/mfa/challenge',
        headers: {
          cookie: pendingCookie2,
        },
        body: {
          codeOrBackup: backupCodes[0],
        },
      });
      assert.equal(challengeReuseRes.statusCode, 401);

      const disableRes = await callRoute(mfaDisableHandler, {
        method: 'POST',
        url: '/api/security/mfa/disable',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: 'sess_current',
            mfaRequired: true,
            mfaPassed: true,
          }),
        },
        body: {
          codeOrBackup: generateCurrentTotpCode(secret),
        },
      });
      assert.equal(disableRes.statusCode, 200);

      const db = getDb();
      const auditRows = await db.execute(sql`
        select event_type
        from audit_events
        where user_id = ${userId}
      `);
      const types = new Set(auditRows.rows.map((row) => String(row.event_type)));
      assert.equal(types.has('auth.mfa.enabled'), true);
      assert.equal(types.has('auth.mfa.challenge.success'), true);
      assert.equal(types.has('auth.mfa.challenge.fail'), true);
      assert.equal(types.has('auth.mfa.disabled'), true);
    });
  },
);
