import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import authMeHandler from '../../server/routes/auth/me.ts';
import sessionsHandler from '../../server/routes/security/sessions.ts';
import revokeAllSessionsHandler from '../../server/routes/security/sessions/revoke-all.ts';
import mfaEnrollStartHandler from '../../server/routes/security/mfa/enroll/start.ts';
import mfaEnrollConfirmHandler from '../../server/routes/security/mfa/enroll/confirm.ts';
import mfaChallengeHandler from '../../server/routes/security/mfa/challenge.ts';
import mfaBackupRegenerateHandler from '../../server/routes/security/mfa/backup/regenerate.ts';
import sharedLinksHandler from '../../server/routes/shared-links/index.ts';
import sharedLinkReadHandler from '../../server/routes/shared-links/[token].ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateBackupCodes,
  generateCurrentTotpCode,
  generateTotpSecret,
  hashBackupCodes,
} from '../../server/_lib/mfa.ts';
import { ApiError } from '../../server/_lib/errors.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';

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
    values (${userId}, ${email}, 'Security Test User', 'user', now(), now())
    on conflict (id) do update
    set email = excluded.email,
        updated_at = now()
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

async function seedSession({
  sessionId,
  userId,
  minutesAgo = 0,
  revoked = false,
  mfaPassed = true,
}) {
  const db = getDb();
  const now = Date.now();
  const seenAt = new Date(now - minutesAgo * 60 * 1000);
  const revokedAt = revoked ? new Date(now - Math.max(1, minutesAgo) * 60 * 1000) : null;
  const mfaPassedAt = mfaPassed ? seenAt : null;
  await db.execute(sql`
    insert into auth_sessions (id, user_id, created_at, last_seen_at, revoked_at, ip_hash, user_agent, device_label, mfa_passed_at)
    values (
      ${sessionId},
      ${userId},
      ${seenAt},
      ${seenAt},
      ${revokedAt},
      ${`hash_${sessionId}`},
      ${`UA ${sessionId}`},
      null,
      ${mfaPassedAt}
    )
    on conflict (id) do update
    set user_id = excluded.user_id,
        created_at = excluded.created_at,
        last_seen_at = excluded.last_seen_at,
        revoked_at = excluded.revoked_at,
        ip_hash = excluded.ip_hash,
        user_agent = excluded.user_agent,
        device_label = excluded.device_label,
        mfa_passed_at = excluded.mfa_passed_at
  `);
}

async function seedMfaEnabledUser({
  userId,
  secret = generateTotpSecret(),
  backupCodes = generateBackupCodes(10),
}) {
  const db = getDb();
  const encryptedSecret = encryptMfaSecret(secret);
  const backupCodesHashedJson = JSON.stringify(hashBackupCodes(backupCodes));
  await db.execute(sql`
    insert into user_mfa (user_id, totp_secret_encrypted, enabled_at, backup_codes_hashed, last_used_at, created_at, updated_at)
    values (${userId}, ${encryptedSecret}, now(), ${backupCodesHashedJson}::jsonb, now(), now(), now())
    on conflict (user_id) do update
    set totp_secret_encrypted = excluded.totp_secret_encrypted,
        enabled_at = excluded.enabled_at,
        backup_codes_hashed = excluded.backup_codes_hashed,
        last_used_at = excluded.last_used_at,
        updated_at = now()
  `);
  return {
    secret,
    backupCodes,
  };
}

async function seedProposal({
  proposalId,
  userId,
  title,
  status = 'draft',
  partyAEmail = null,
  partyBEmail = null,
}) {
  const db = getDb();
  await db.execute(sql`
    insert into proposals (id, user_id, title, status, proposal_type, draft_step, party_a_email, party_b_email, payload, created_at, updated_at)
    values (
      ${proposalId},
      ${userId},
      ${title},
      ${status},
      'standard',
      1,
      ${partyAEmail},
      ${partyBEmail},
      '{}'::jsonb,
      now(),
      now()
    )
    on conflict (id) do update
    set title = excluded.title,
        status = excluded.status,
        updated_at = now()
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

function findSetCookie(res, cookieName) {
  const header = res.getHeader('set-cookie');
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return values.map((value) => String(value)).find((value) => value.startsWith(`${cookieName}=`)) || null;
}

function cookieTokenFromSetCookie(setCookie) {
  if (!setCookie) {
    return '';
  }
  const firstPart = String(setCookie).split(';')[0];
  const separator = firstPart.indexOf('=');
  if (separator < 0) {
    return '';
  }
  return decodeURIComponent(firstPart.slice(separator + 1));
}

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) {
    return '';
  }
  return String(setCookie).split(';')[0] || '';
}

function decodeSessionPayload(sessionToken) {
  const [encodedPayload] = String(sessionToken || '').split('.');
  if (!encodedPayload) {
    return null;
  }
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
}

const dbAvailable = hasDatabaseUrl();

test(
  'security sanity checks (skipped: DATABASE_URL missing)',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async (t) => {
    await ensureMigrated();

    await t.test('revoked sessions are rejected server-side', async () => {
      await resetTables();
      const userId = 'security_revoked_user';
      const email = 'security-revoked@example.com';
      const sid = 'sess_revoked';
      await seedUser(userId, email);
      await seedSession({ sessionId: sid, userId, revoked: true, mfaPassed: true });

      const res = await callRoute(authMeHandler, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.jsonBody().error?.code, 'unauthorized');
    });

    await t.test('invalid cookie signature cannot create users or persisted sessions', async () => {
      await resetTables();
      const userId = 'security_invalid_cookie_user';
      const email = 'security-invalid-cookie@example.com';
      const validCookie = makeSessionCookie({
        sub: userId,
        email,
      });
      const tamperedCookie = `${validCookie.slice(0, -1)}${validCookie.endsWith('a') ? 'b' : 'a'}`;

      const res = await callRoute(authMeHandler, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: tamperedCookie,
        },
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.jsonBody().error?.code, 'unauthorized');

      const db = getDb();
      const userRows = await db.execute(sql`
        select count(*)::int as count
        from users
        where id = ${userId}
      `);
      const sessionRows = await db.execute(sql`
        select count(*)::int as count
        from auth_sessions
        where user_id = ${userId}
      `);
      assert.equal(Number(userRows.rows[0]?.count || 0), 0);
      assert.equal(Number(sessionRows.rows[0]?.count || 0), 0);
    });

    await t.test('sign out everywhere revokes all sessions including current and clears cookie', async () => {
      await resetTables();
      const userId = 'security_revoke_everywhere_user';
      const email = 'security-revoke-everywhere@example.com';
      const currentSid = 'sess_current_everywhere';
      const otherSid = 'sess_other_everywhere';
      await seedUser(userId, email);
      await seedSession({ sessionId: currentSid, userId, mfaPassed: true });
      await seedSession({ sessionId: otherSid, userId, minutesAgo: 4, mfaPassed: true });

      const revokeRes = await callRoute(revokeAllSessionsHandler, {
        method: 'POST',
        url: '/api/security/sessions/revoke-all',
        headers: {
          cookie: sessionCookie({ userId, email, sid: currentSid }),
        },
        body: {
          includeCurrent: true,
        },
      });

      assert.equal(revokeRes.statusCode, 200);
      assert.equal(Boolean(revokeRes.jsonBody().signed_out), true);
      assert.equal(Number(revokeRes.jsonBody().revoked_count), 2);
      const clearedSessionCookie = findSetCookie(revokeRes, 'pm_session');
      assert.ok(clearedSessionCookie, 'expected pm_session clearing cookie');
      assert.equal(clearedSessionCookie.includes('Max-Age=0'), true);

      const db = getDb();
      const rows = await db.execute(sql`
        select id, revoked_at is not null as revoked
        from auth_sessions
        where user_id = ${userId}
      `);
      const revokedById = Object.fromEntries(rows.rows.map((row) => [String(row.id), Boolean(row.revoked)]));
      assert.equal(revokedById[currentSid], true);
      assert.equal(revokedById[otherSid], true);

      const meAfterRevokeRes = await callRoute(authMeHandler, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: sessionCookie({ userId, email, sid: currentSid }),
        },
      });
      assert.equal(meAfterRevokeRes.statusCode, 401);
    });

    await t.test('last_seen_at writes are throttled', async () => {
      await resetTables();
      const userId = 'security_last_seen_user';
      const email = 'security-last-seen@example.com';
      const sid = 'sess_last_seen';
      await seedUser(userId, email);
      await seedSession({ sessionId: sid, userId, minutesAgo: 2, mfaPassed: true });

      const db = getDb();
      const beforeThrottle = await db.execute(sql`
        select last_seen_at
        from auth_sessions
        where id = ${sid}
      `);
      const lastSeenInitial = new Date(beforeThrottle.rows[0].last_seen_at);

      const withinWindowRes = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
      });
      assert.equal(withinWindowRes.statusCode, 200);

      const afterWithinWindow = await db.execute(sql`
        select last_seen_at
        from auth_sessions
        where id = ${sid}
      `);
      const lastSeenAfterWithinWindow = new Date(afterWithinWindow.rows[0].last_seen_at);
      assert.equal(lastSeenAfterWithinWindow.getTime(), lastSeenInitial.getTime());

      const staleSeenAt = new Date(Date.now() - 11 * 60 * 1000);
      await db.execute(sql`
        update auth_sessions
        set last_seen_at = ${staleSeenAt}
        where id = ${sid}
      `);

      const staleBeforeTouch = await db.execute(sql`
        select last_seen_at
        from auth_sessions
        where id = ${sid}
      `);
      const staleValue = new Date(staleBeforeTouch.rows[0].last_seen_at);

      const staleRes = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
      });
      assert.equal(staleRes.statusCode, 200);

      const staleAfterTouch = await db.execute(sql`
        select last_seen_at
        from auth_sessions
        where id = ${sid}
      `);
      const staleTouchedValue = new Date(staleAfterTouch.rows[0].last_seen_at);
      assert.equal(staleTouchedValue.getTime() > staleValue.getTime(), true);
    });

    await t.test('pending MFA cannot access privileged proposal and session routes', async () => {
      await resetTables();
      const userId = 'security_mfa_pending_blocked_user';
      const email = 'security-mfa-pending-blocked@example.com';
      const sid = 'sess_pending_blocked';
      const proposalId = 'proposal_pending_blocked';
      await seedUser(userId, email);
      await seedSession({ sessionId: sid, userId, mfaPassed: false });
      await seedProposal({
        proposalId,
        userId,
        title: 'Pending MFA Proposal',
        status: 'draft',
      });

      const pendingCookie = sessionCookie({
        userId,
        email,
        sid,
        mfaRequired: true,
        mfaPassed: false,
      });

      const sessionsRes = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: pendingCookie,
        },
      });
      assert.equal(sessionsRes.statusCode, 401);
      assert.equal(sessionsRes.jsonBody().error?.code, 'mfa_required');

      const proposalsRes = await callRoute(proposalsHandler, {
        method: 'GET',
        url: '/api/proposals',
        headers: {
          cookie: pendingCookie,
        },
      });
      assert.equal(proposalsRes.statusCode, 401);
      assert.equal(proposalsRes.jsonBody().error?.code, 'mfa_required');

      const proposalEditRes = await callRoute(proposalDetailHandler, {
        method: 'PATCH',
        url: `/api/proposals/${proposalId}`,
        headers: {
          cookie: pendingCookie,
        },
        body: {
          title: 'Should not update',
        },
      }, proposalId);
      assert.equal(proposalEditRes.statusCode, 401);
      assert.equal(proposalEditRes.jsonBody().error?.code, 'mfa_required');
    });

    await t.test('MFA challenge rotates pending sid and revokes previous session', async () => {
      await resetTables();
      const userId = 'security_mfa_rotate_user';
      const email = 'security-mfa-rotate@example.com';
      const pendingSid = 'sess_pending_rotate';
      await seedUser(userId, email);
      const { secret } = await seedMfaEnabledUser({ userId });
      await seedSession({ sessionId: pendingSid, userId, mfaPassed: false });

      const challengeRes = await callRoute(mfaChallengeHandler, {
        method: 'POST',
        url: '/api/security/mfa/challenge',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: pendingSid,
            mfaRequired: true,
            mfaPassed: false,
          }),
        },
        body: {
          codeOrBackup: generateCurrentTotpCode(secret),
        },
      });

      assert.equal(challengeRes.statusCode, 200);
      const setCookie = findSetCookie(challengeRes, 'pm_session');
      assert.ok(setCookie, 'pm_session cookie should be set after challenge');
      const nextToken = cookieTokenFromSetCookie(setCookie);
      const nextPayload = decodeSessionPayload(nextToken);
      assert.ok(nextPayload?.sid, 'new sid should be present');
      assert.notEqual(nextPayload.sid, pendingSid);
      assert.equal(Boolean(nextPayload.mfa_passed), true);

      const db = getDb();
      const rows = await db.execute(sql`
        select id, revoked_at, mfa_passed_at
        from auth_sessions
        where user_id = ${userId}
      `);
      const byId = Object.fromEntries(rows.rows.map((row) => [String(row.id), row]));
      assert.ok(byId[pendingSid], 'old pending sid should exist');
      assert.equal(byId[pendingSid].revoked_at !== null, true);
      assert.ok(byId[nextPayload.sid], 'rotated sid should exist');
      assert.equal(byId[nextPayload.sid].mfa_passed_at !== null, true);

      const oldCookieRejectedRes = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: pendingSid,
            mfaRequired: true,
            mfaPassed: false,
          }),
        },
      });
      assert.equal(oldCookieRejectedRes.statusCode, 401);
      assert.equal(oldCookieRejectedRes.jsonBody().error?.code, 'unauthorized');

      const newCookieHeader = cookieHeaderFromSetCookie(setCookie);
      assert.ok(newCookieHeader, 'expected rotated session cookie header');
      const newCookieAcceptedRes = await callRoute(sessionsHandler, {
        method: 'GET',
        url: '/api/security/sessions',
        headers: {
          cookie: newCookieHeader,
        },
      });
      assert.equal(newCookieAcceptedRes.statusCode, 200);
    });

    await t.test('MFA challenge failure logging is rate-limited and does not store secrets/raw IP', async () => {
      await resetTables();
      const userId = 'security_mfa_rate_limit_user';
      const email = 'security-mfa-rate-limit@example.com';
      const sid = 'sess_mfa_rate_limit';
      await seedUser(userId, email);
      await seedMfaEnabledUser({ userId });
      await seedSession({ sessionId: sid, userId, mfaPassed: false });

      const statuses = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const res = await callRoute(mfaChallengeHandler, {
          method: 'POST',
          url: '/api/security/mfa/challenge',
          headers: {
            cookie: sessionCookie({
              userId,
              email,
              sid,
              mfaRequired: true,
              mfaPassed: false,
            }),
            'x-forwarded-for': '203.0.113.9',
          },
          body: {
            codeOrBackup: 'SECRET-123',
          },
        });
        statuses.push(res.statusCode);
      }

      assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
      assert.equal(statuses[5], 429);

      const db = getDb();
      const rows = await db.execute(sql`
        select ip_hash, metadata
        from audit_events
        where user_id = ${userId}
          and event_type = 'auth.mfa.challenge.fail'
      `);
      assert.equal(rows.rows.length, 5);
      for (const row of rows.rows) {
        const ipHash = String(row.ip_hash || '');
        const metadataJson = JSON.stringify(row.metadata || {});
        assert.equal(ipHash.length, 64);
        assert.match(ipHash, /^[a-f0-9]{64}$/i);
        assert.notEqual(ipHash, '203.0.113.9');
        assert.equal(metadataJson.includes('SECRET-123'), false);
      }
    });

    await t.test('share.* audit events are emitted by live share and proposal routes', async () => {
      await resetTables();
      const userId = 'security_share_events_user';
      const email = 'security-share-events@example.com';
      const sid = 'sess_share_events';
      await seedUser(userId, email);
      await seedSession({ sessionId: sid, userId, mfaPassed: true });
      await seedProposal({
        proposalId: 'proposal_share_1',
        userId,
        title: 'Share Event Proposal 1',
        status: 'draft',
        partyAEmail: email,
      });
      await seedProposal({
        proposalId: 'proposal_share_2',
        userId,
        title: 'Share Event Proposal 2',
        status: 'revealed',
        partyAEmail: email,
      });

      const createShareRes = await callRoute(sharedLinksHandler, {
        method: 'POST',
        url: '/api/shared-links',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
        body: {
          proposalId: 'proposal_share_1',
          recipientEmail: 'recipient@example.com',
          idempotencyKey: 'security-share-events',
          maxUses: 5,
        },
      });
      assert.equal(createShareRes.statusCode, 201);
      const token = String(createShareRes.jsonBody().sharedLink.token);
      assert.ok(token);

      const readShareRes = await callRoute(sharedLinkReadHandler, {
        method: 'GET',
        url: `/api/shared-links/${token}`,
        query: {
          token,
          consume: 'true',
        },
      }, token);
      assert.equal(readShareRes.statusCode, 200);

      const revealRequestedRes = await callRoute(proposalDetailHandler, {
        method: 'PATCH',
        url: '/api/proposals/proposal_share_1',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
        body: {
          status: 'revealed',
        },
      }, 'proposal_share_1');
      assert.equal(revealRequestedRes.statusCode, 200);

      const revealApprovedRes = await callRoute(proposalDetailHandler, {
        method: 'PATCH',
        url: '/api/proposals/proposal_share_1',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
        body: {
          status: 'mutual_interest',
        },
      }, 'proposal_share_1');
      assert.equal(revealApprovedRes.statusCode, 200);

      const revealDeniedRes = await callRoute(proposalDetailHandler, {
        method: 'PATCH',
        url: '/api/proposals/proposal_share_2',
        headers: {
          cookie: sessionCookie({ userId, email, sid }),
        },
        body: {
          status: 'lost',
        },
      }, 'proposal_share_2');
      assert.equal(revealDeniedRes.statusCode, 200);

      const db = getDb();
      const events = await db.execute(sql`
        select event_type
        from audit_events
        where user_id = ${userId}
      `);
      const types = new Set(events.rows.map((row) => String(row.event_type)));
      assert.equal(types.has('share.link.created'), true);
      assert.equal(types.has('share.link.accessed'), true);
      assert.equal(types.has('share.reveal.requested'), true);
      assert.equal(types.has('share.reveal.approved'), true);
      assert.equal(types.has('share.reveal.denied'), true);
    });

    await t.test('backup code regeneration revokes prior backup codes', async () => {
      await resetTables();
      const userId = 'security_backup_regen_user';
      const email = 'security-backup-regen@example.com';
      const currentSid = 'sess_backup_current';
      await seedUser(userId, email);
      await seedVerifiedProfile(userId, email);
      await seedSession({ sessionId: currentSid, userId, mfaPassed: true });

      const authCookie = sessionCookie({ userId, email, sid: currentSid });

      const enrollStartRes = await callRoute(mfaEnrollStartHandler, {
        method: 'POST',
        url: '/api/security/mfa/enroll/start',
        headers: {
          cookie: authCookie,
        },
        body: {},
      });
      assert.equal(enrollStartRes.statusCode, 200);
      const secret = String(enrollStartRes.jsonBody().enrollment.secret);
      const initialTotp = generateCurrentTotpCode(secret);

      const enrollConfirmRes = await callRoute(mfaEnrollConfirmHandler, {
        method: 'POST',
        url: '/api/security/mfa/enroll/confirm',
        headers: {
          cookie: authCookie,
        },
        body: {
          code: initialTotp,
        },
      });
      assert.equal(enrollConfirmRes.statusCode, 200);
      const oldBackupCode = String(enrollConfirmRes.jsonBody().backup_codes[0]);
      assert.ok(oldBackupCode);

      const regenerateRes = await callRoute(mfaBackupRegenerateHandler, {
        method: 'POST',
        url: '/api/security/mfa/backup/regenerate',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: currentSid,
            mfaRequired: true,
            mfaPassed: true,
          }),
        },
        body: {
          code: generateCurrentTotpCode(secret),
        },
      });
      assert.equal(regenerateRes.statusCode, 200);
      const newBackupCode = String(regenerateRes.jsonBody().backup_codes[0]);
      assert.ok(newBackupCode);
      assert.notEqual(newBackupCode, oldBackupCode);

      await seedSession({ sessionId: 'sess_backup_pending_old', userId, mfaPassed: false });
      await seedSession({ sessionId: 'sess_backup_pending_new', userId, mfaPassed: false });

      const oldCodeRes = await callRoute(mfaChallengeHandler, {
        method: 'POST',
        url: '/api/security/mfa/challenge',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: 'sess_backup_pending_old',
            mfaRequired: true,
            mfaPassed: false,
          }),
        },
        body: {
          codeOrBackup: oldBackupCode,
        },
      });
      assert.equal(oldCodeRes.statusCode, 401);

      const newCodeRes = await callRoute(mfaChallengeHandler, {
        method: 'POST',
        url: '/api/security/mfa/challenge',
        headers: {
          cookie: sessionCookie({
            userId,
            email,
            sid: 'sess_backup_pending_new',
            mfaRequired: true,
            mfaPassed: false,
          }),
        },
        body: {
          codeOrBackup: newBackupCode,
        },
      });
      assert.equal(newCodeRes.statusCode, 200);
    });
  },
);

test('MFA encryption key handling uses safe key derivation and explicit failures', () => {
  const previousKey = process.env.MFA_ENCRYPTION_KEY;
  try {
    const sourceSecret = generateTotpSecret();

    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const encryptedBase64Key = encryptMfaSecret(sourceSecret);
    assert.equal(decryptMfaSecret(encryptedBase64Key), sourceSecret);

    process.env.MFA_ENCRYPTION_KEY = 'short-human-readable-key';
    const encryptedDerivedKey = encryptMfaSecret(sourceSecret);
    assert.equal(decryptMfaSecret(encryptedDerivedKey), sourceSecret);

    process.env.MFA_ENCRYPTION_KEY = '';
    assert.throws(
      () => encryptMfaSecret(sourceSecret),
      (error) => error instanceof ApiError && error.code === 'not_configured',
    );

    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('hex');
    assert.throws(
      () => decryptMfaSecret('not-a-valid-payload'),
      (error) => error instanceof ApiError && error.code === 'mfa_secret_invalid',
    );
  } finally {
    process.env.MFA_ENCRYPTION_KEY = previousKey;
  }
});
