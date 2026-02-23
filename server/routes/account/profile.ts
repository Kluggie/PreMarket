import { eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { normalizeNotificationSettings } from '../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const VALID_PRIVACY_MODES = new Set(['public', 'pseudonymous', 'private']);
const VALID_USER_TYPES = new Set(['individual', 'business']);

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

function sanitizeSocialLinks(value: unknown) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    linkedin: toOptionalText((source as any).linkedin) || '',
    twitter: toOptionalText((source as any).twitter) || '',
    github: toOptionalText((source as any).github) || '',
    crunchbase: toOptionalText((source as any).crunchbase) || '',
  };
}

function sanitizeNotificationSettings(value: unknown) {
  return normalizeNotificationSettings(value);
}

function mapProfileRow(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    user_id: profile.userId,
    user_email: profile.userEmail,
    pseudonym: profile.pseudonym || '',
    user_type: profile.userType || 'individual',
    title: profile.title || '',
    industry: profile.industry || '',
    location: profile.location || '',
    bio: profile.bio || '',
    website: profile.website || '',
    privacy_mode: profile.privacyMode || 'pseudonymous',
    social_links: profile.socialLinks || {
      linkedin: '',
      twitter: '',
      github: '',
      crunchbase: '',
    },
    social_links_ai_consent: Boolean(profile.socialLinksAiConsent),
    notification_settings: sanitizeNotificationSettings(profile.notificationSettings || {}),
    email_verified: Boolean(profile.emailVerified),
    document_verified: Boolean(profile.documentVerified),
    verification_status: profile.verificationStatus || 'unverified',
    created_date: profile.createdAt,
    updated_date: profile.updatedAt,
  };
}

function buildProfilePatch(source) {
  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(source, 'pseudonym')) {
    patch.pseudonym = toOptionalText(source.pseudonym);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'user_type')) {
    const userType = String(source.user_type || '').trim().toLowerCase();
    patch.userType = VALID_USER_TYPES.has(userType) ? userType : 'individual';
  }

  if (Object.prototype.hasOwnProperty.call(source, 'title')) {
    patch.title = toOptionalText(source.title);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'industry')) {
    patch.industry = toOptionalText(source.industry);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'location')) {
    patch.location = toOptionalText(source.location);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'bio')) {
    patch.bio = toOptionalText(source.bio);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'website')) {
    patch.website = toOptionalText(source.website);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'privacy_mode')) {
    const privacyMode = String(source.privacy_mode || '').trim().toLowerCase();
    patch.privacyMode = VALID_PRIVACY_MODES.has(privacyMode) ? privacyMode : 'pseudonymous';
  }

  if (Object.prototype.hasOwnProperty.call(source, 'social_links')) {
    patch.socialLinks = sanitizeSocialLinks(source.social_links);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'social_links_ai_consent')) {
    patch.socialLinksAiConsent = toBoolean(source.social_links_ai_consent);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'notification_settings')) {
    patch.notificationSettings = sanitizeNotificationSettings(source.notification_settings);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'email_verified')) {
    patch.emailVerified = toBoolean(source.email_verified);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'document_verified')) {
    patch.documentVerified = toBoolean(source.document_verified);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'verification_status')) {
    patch.verificationStatus = toOptionalText(source.verification_status) || 'unverified';
  }

  return patch;
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/profile', async (context) => {
    ensureMethod(req, ['GET', 'PUT']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, auth.user.id))
      .limit(1);

    if (req.method === 'GET') {
      ok(res, 200, {
        profile: mapProfileRow(existing || null),
      });
      return;
    }

    const body = await readJsonBody(req);
    const source = body.profile && typeof body.profile === 'object' ? body.profile : body;
    const patch = buildProfilePatch(source || {});
    const now = new Date();

    let savedRow = existing;

    if (!existing) {
      const profileId = newId('profile');
      const [created] = await db
        .insert(schema.userProfiles)
        .values({
          id: profileId,
          userId: auth.user.id,
          userEmail: normalizeEmail(auth.user.email),
          pseudonym: null,
          userType: 'individual',
          title: null,
          industry: null,
          location: null,
          bio: null,
          website: null,
          privacyMode: 'pseudonymous',
          socialLinks: {
            linkedin: '',
            twitter: '',
            github: '',
            crunchbase: '',
          },
          socialLinksAiConsent: false,
          notificationSettings: {
            email_notifications: true,
            email_proposals: true,
            email_evaluations: true,
            email_reveals: true,
            email_marketing: false,
          },
          emailVerified: false,
          documentVerified: false,
          verificationStatus: 'unverified',
          createdAt: now,
          updatedAt: now,
          ...patch,
        })
        .returning();

      savedRow = created;
    } else {
      const [updated] = await db
        .update(schema.userProfiles)
        .set({
          ...patch,
          userEmail: normalizeEmail(auth.user.email),
          updatedAt: now,
        })
        .where(eq(schema.userProfiles.id, existing.id))
        .returning();

      savedRow = updated;
    }

    const nextConsent =
      Object.prototype.hasOwnProperty.call(patch, 'socialLinksAiConsent') && savedRow
        ? Boolean(savedRow.socialLinksAiConsent)
        : null;
    const previousConsent = existing ? Boolean(existing.socialLinksAiConsent) : null;

    if (
      savedRow &&
      nextConsent !== null &&
      previousConsent !== null &&
      previousConsent !== nextConsent
    ) {
      await db.insert(schema.auditLogs).values({
        id: newId('audit'),
        entityType: 'UserProfile',
        entityId: savedRow.id,
        userId: auth.user.id,
        userEmail: normalizeEmail(auth.user.email),
        action: 'consent_change',
        details: {
          field: 'social_links_ai_consent',
          old_value: previousConsent,
          new_value: nextConsent,
          timestamp: now.toISOString(),
        },
        createdAt: now,
      });
    }

    if (!savedRow) {
      throw new ApiError(500, 'profile_save_failed', 'Unable to save profile');
    }

    ok(res, 200, {
      profile: mapProfileRow(savedRow),
    });
  });
}
