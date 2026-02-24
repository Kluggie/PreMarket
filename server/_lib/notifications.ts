import { eq } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { normalizeEmailCategory, sendCategorizedEmail } from './email-delivery.js';
import { newId } from './ids.js';

export const DEFAULT_NOTIFICATION_SETTINGS = {
  email_notifications: true,
  email_proposals: true,
  email_evaluations: true,
  email_reveals: true,
  email_marketing: false,
};

const EVENT_SETTING_KEY = {
  new_proposal: 'email_proposals',
  evaluation_update: 'email_evaluations',
  reveal_request: 'email_reveals',
  mutual_interest: 'email_reveals',
  status_won: 'email_proposals',
  status_lost: 'email_proposals',
} as const;

const EVENT_EMAIL_CATEGORY = {
  new_proposal: 'proposal_received',
  evaluation_update: 'evaluation_complete',
  reveal_request: 'shared_link_activity',
  mutual_interest: 'mutual_interest',
  status_won: 'shared_link_activity',
  status_lost: 'shared_link_activity',
} as const;

function toBoolean(value: unknown) {
  return Boolean(value);
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeNotificationSettings(value: unknown) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    email_notifications: toBoolean(
      (source as any).email_notifications ?? DEFAULT_NOTIFICATION_SETTINGS.email_notifications,
    ),
    email_proposals: toBoolean(
      (source as any).email_proposals ?? DEFAULT_NOTIFICATION_SETTINGS.email_proposals,
    ),
    email_evaluations: toBoolean(
      (source as any).email_evaluations ?? DEFAULT_NOTIFICATION_SETTINGS.email_evaluations,
    ),
    email_reveals: toBoolean(
      (source as any).email_reveals ?? DEFAULT_NOTIFICATION_SETTINGS.email_reveals,
    ),
    email_marketing: toBoolean(
      (source as any).email_marketing ?? DEFAULT_NOTIFICATION_SETTINGS.email_marketing,
    ),
  };
}

export function mapNotificationRow(row) {
  return {
    id: row.id,
    event_type: row.eventType || 'general',
    title: row.title || 'Notification',
    message: row.message || '',
    action_url: row.actionUrl || null,
    read: Boolean(row.readAt),
    read_at: row.readAt || null,
    metadata: row.metadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

export async function createNotificationEvent(input: {
  db?: any;
  userId: string;
  userEmail?: string | null;
  eventType: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
  emailCategory?: string | null;
  emailSubject?: string | null;
  emailText?: string | null;
  emailHtml?: string | null;
  sendEmail?: boolean;
}) {
  const db = input.db || getDb();
  const userId = asText(input.userId);
  if (!userId) {
    return { created: false, reason: 'missing_user' as const };
  }

  const [userRow, profileRow] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
      .then((rows) => rows[0] || null),
    db
      .select({
        notificationSettings: schema.userProfiles.notificationSettings,
      })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1)
      .then((rows) => rows[0] || null),
  ]);

  if (!userRow) {
    return { created: false, reason: 'missing_user' as const };
  }

  const notificationSettings = normalizeNotificationSettings(profileRow?.notificationSettings || {});
  const eventType = asText(input.eventType).toLowerCase() || 'general';
  const settingKey = Object.prototype.hasOwnProperty.call(EVENT_SETTING_KEY, eventType)
    ? EVENT_SETTING_KEY[eventType as keyof typeof EVENT_SETTING_KEY]
    : null;

  if (settingKey && !notificationSettings[settingKey]) {
    return { created: false, reason: 'disabled_by_user' as const };
  }

  const now = new Date();
  const dedupeKey = asText(input.dedupeKey) || null;
  const insertBuilder = db.insert(schema.notifications).values({
    id: newId('notification'),
    userId,
    eventType,
    title: asText(input.title) || 'Notification',
    message: asText(input.message) || '',
    actionUrl: asText(input.actionUrl) || null,
    dedupeKey,
    readAt: null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdAt: now,
    updatedAt: now,
  });

  const [created] = dedupeKey
    ? await insertBuilder
        .onConflictDoNothing({
          target: [schema.notifications.userId, schema.notifications.dedupeKey],
        })
        .returning()
    : await insertBuilder.returning();

  if (!created) {
    return { created: false, reason: 'duplicate_event' as const };
  }

  const recipientEmail = asText(input.userEmail || userRow.email);
  const shouldAttemptEmail =
    (input.sendEmail ?? true) &&
    notificationSettings.email_notifications &&
    Boolean(recipientEmail && isLikelyEmail(recipientEmail));

  if (shouldAttemptEmail && (input.emailSubject || input.emailText || input.emailHtml)) {
    try {
      const defaultCategory = Object.prototype.hasOwnProperty.call(EVENT_EMAIL_CATEGORY, eventType)
        ? EVENT_EMAIL_CATEGORY[eventType as keyof typeof EVENT_EMAIL_CATEGORY]
        : 'shared_link_activity';
      const emailCategory = normalizeEmailCategory(input.emailCategory) || defaultCategory;

      await sendCategorizedEmail({
        category: emailCategory,
        to: recipientEmail,
        subject: asText(input.emailSubject) || asText(input.title) || 'PreMarket notification',
        dedupeKey,
        text: asText(input.emailText) || asText(input.message) || 'You have a new notification.',
        html: asText(input.emailHtml) || null,
      });
    } catch {
      // Best-effort email send. In-app notifications remain canonical.
    }
  }

  return {
    created: true,
    notification: created,
  };
}
