import { getResendConfig } from './integrations.js';
import { eq } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { newId } from './ids.js';

export const EMAIL_MODE_VALUES = ['contact_only', 'transactional', 'disabled'] as const;
export type EmailMode = (typeof EMAIL_MODE_VALUES)[number];

export const EMAIL_CATEGORIES = [
  'contact_support',
  'contact_sales',
  'proposal_received',
  'evaluation_complete',
  'proposal_reevaluation_complete',
  'mutual_interest',
  'shared_link_activity',
  'account_verification',
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

const CONTACT_ONLY_CATEGORIES = new Set<EmailCategory>(['contact_support', 'contact_sales']);

const EMAIL_CATEGORY_SET = new Set<EmailCategory>(EMAIL_CATEGORIES);
const EMAIL_MODE_SET = new Set<EmailMode>(EMAIL_MODE_VALUES);

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmails(value: string | string[]) {
  const list = Array.isArray(value) ? value : [value];

  return list
    .map((entry) => asText(entry).toLowerCase())
    .filter((entry, index, source) => isLikelyEmail(entry) && source.indexOf(entry) === index);
}

function normalizeOptionalEmails(value?: string | string[] | null) {
  if (value == null) {
    return [] as string[];
  }

  return normalizeEmails(value);
}

function firstLikelyEmail(values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = asText(value).toLowerCase();
    if (isLikelyEmail(normalized)) {
      return normalized;
    }
  }

  return '';
}

function redactOtpLikeCode(value: string) {
  return asText(value).replace(/\b\d{6}\b/g, '[redacted-code]');
}

export function getEmailMode(): EmailMode {
  const configured = asText(process.env.EMAIL_MODE).toLowerCase();
  if (EMAIL_MODE_SET.has(configured as EmailMode)) {
    return configured as EmailMode;
  }

  return 'contact_only';
}

export function isEmailCategory(value: unknown): value is EmailCategory {
  const normalized = asText(value).toLowerCase();
  return EMAIL_CATEGORY_SET.has(normalized as EmailCategory);
}

export function normalizeEmailCategory(value: unknown): EmailCategory | null {
  const normalized = asText(value).toLowerCase();
  if (EMAIL_CATEGORY_SET.has(normalized as EmailCategory)) {
    return normalized as EmailCategory;
  }

  return null;
}

export function isCategoryAllowedByMode(mode: EmailMode, category: EmailCategory) {
  if (mode === 'disabled') {
    return false;
  }

  if (mode === 'contact_only') {
    return CONTACT_ONLY_CATEGORIES.has(category);
  }

  return true;
}

function isTransactionalCategory(category: EmailCategory) {
  return !category.startsWith('contact_');
}

function shouldUseDevEmailSink(mode: EmailMode) {
  const nodeEnv = asText(process.env.NODE_ENV).toLowerCase();
  return mode === 'transactional' && nodeEnv !== 'production';
}

function resolveDevEmailSink() {
  const sink = asText(process.env.DEV_EMAIL_SINK).toLowerCase();
  return isLikelyEmail(sink) ? sink : '';
}

export function resolveSupportInboxEmail() {
  return firstLikelyEmail([process.env.SUPPORT_INBOX_EMAIL]) || 'support@getpremarket.com';
}

export function resolveSalesInboxEmail() {
  return firstLikelyEmail([process.env.SALES_INBOX_EMAIL]) || 'sales@getpremarket.com';
}

function logBlockedEmail(input: {
  category: EmailCategory;
  mode: EmailMode;
  reason: 'blocked_disabled' | 'blocked_contact_only';
  recipients: string[];
  subject: string;
  dedupeKey: string | null;
}) {
  console.info('[email-delivery] blocked', {
    category: input.category,
    mode: input.mode,
    reason: input.reason,
    to: input.recipients,
    subject: redactOtpLikeCode(input.subject),
    dedupeKey: input.dedupeKey,
  });
}

function logDedupedEmail(input: {
  category: EmailCategory;
  recipients: string[];
  subject: string;
  dedupeKey: string;
}) {
  console.info('[email-delivery] deduped', {
    category: input.category,
    to: input.recipients,
    subject: redactOtpLikeCode(input.subject),
    dedupeKey: input.dedupeKey,
  });
}

function logSentEmail(input: {
  category: EmailCategory;
  recipients: string[];
  subject: string;
  dedupeKey: string | null;
}) {
  console.info('[email-delivery] sent', {
    category: input.category,
    to: input.recipients,
    subject: redactOtpLikeCode(input.subject),
    dedupeKey: input.dedupeKey,
    status: 'sent',
  });
}

export type SendCategorizedEmailResult =
  | {
      status: 'sent';
      sent: true;
      blocked: false;
      category: EmailCategory;
      mode: EmailMode;
    }
  | {
      status: 'blocked';
      sent: false;
      blocked: true;
      category: EmailCategory;
      mode: EmailMode;
      reason: 'blocked_disabled' | 'blocked_contact_only';
    }
  | {
      status: 'deduped';
      sent: false;
      blocked: true;
      deduped: true;
      category: EmailCategory;
      mode: EmailMode;
      reason: 'deduped';
    }
  | {
      status: 'not_configured';
      sent: false;
      blocked: false;
      category: EmailCategory;
      mode: EmailMode;
      reason: 'not_configured';
    }
  | {
      status: 'invalid_input';
      sent: false;
      blocked: false;
      category: EmailCategory;
      mode: EmailMode;
      reason: 'invalid_input' | 'missing_dedupe_key';
    }
  | {
      status: 'failed';
      sent: false;
      blocked: false;
      category: EmailCategory;
      mode: EmailMode;
      reason: 'provider_rejected' | 'provider_unavailable';
      providerStatus: number;
    };

export async function sendCategorizedEmail(input: {
  category: EmailCategory;
  to: string | string[];
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  subject: string;
  dedupeKey?: string | null;
  text?: string | null;
  html?: string | null;
  replyTo?: string | null;
  db?: any;
}) {
  const mode = getEmailMode();
  const rawRecipientsTo = normalizeEmails(input.to);
  const rawRecipientsCc = normalizeOptionalEmails(input.cc);
  const rawRecipientsBcc = normalizeOptionalEmails(input.bcc);
  const subject = asText(input.subject);
  const dedupeKey = asText(input.dedupeKey) || null;
  const text = asText(input.text);
  const html = asText(input.html);
  const replyTo = asText(input.replyTo).toLowerCase();
  const transactionalCategory = isTransactionalCategory(input.category);
  const devSink = shouldUseDevEmailSink(mode) ? resolveDevEmailSink() : '';
  const recipientsTo = devSink ? [devSink] : rawRecipientsTo;
  const recipientsCc = devSink ? [] : rawRecipientsCc;
  const recipientsBcc = devSink ? [] : rawRecipientsBcc;
  const allRecipients = [...recipientsTo, ...recipientsCc, ...recipientsBcc];

  if (!recipientsTo.length || !subject || (!text && !html)) {
    return {
      status: 'invalid_input',
      sent: false,
      blocked: false,
      category: input.category,
      mode,
      reason: 'invalid_input',
    } satisfies SendCategorizedEmailResult;
  }

  if (mode === 'transactional' && transactionalCategory && !dedupeKey) {
    return {
      status: 'invalid_input',
      sent: false,
      blocked: false,
      category: input.category,
      mode,
      reason: 'missing_dedupe_key',
    } satisfies SendCategorizedEmailResult;
  }

  if (mode === 'disabled') {
    logBlockedEmail({
      category: input.category,
      mode,
      reason: 'blocked_disabled',
      recipients: allRecipients,
      subject,
      dedupeKey,
    });
    return {
      status: 'blocked',
      sent: false,
      blocked: true,
      category: input.category,
      mode,
      reason: 'blocked_disabled',
    } satisfies SendCategorizedEmailResult;
  }

  if (!isCategoryAllowedByMode(mode, input.category)) {
    logBlockedEmail({
      category: input.category,
      mode,
      reason: 'blocked_contact_only',
      recipients: allRecipients,
      subject,
      dedupeKey,
    });
    return {
      status: 'blocked',
      sent: false,
      blocked: true,
      category: input.category,
      mode,
      reason: 'blocked_contact_only',
    } satisfies SendCategorizedEmailResult;
  }

  const resend = getResendConfig();
  if (!resend.ready) {
    return {
      status: 'not_configured',
      sent: false,
      blocked: false,
      category: input.category,
      mode,
      reason: 'not_configured',
    } satisfies SendCategorizedEmailResult;
  }

  const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
  const payload: Record<string, unknown> = {
    from,
    to: recipientsTo,
    subject,
  };

  if (recipientsCc.length) {
    payload.cc = recipientsCc;
  }

  if (recipientsBcc.length) {
    payload.bcc = recipientsBcc;
  }

  if (text) {
    payload.text = text;
  }

  if (html) {
    payload.html = html;
  }

  if (replyTo && isLikelyEmail(replyTo)) {
    payload.reply_to = replyTo;
  } else if (resend.replyTo) {
    payload.reply_to = resend.replyTo;
  }

  let claimedDedupeKey = false;
  let db = input.db || null;

  if (dedupeKey && transactionalCategory) {
    db = db || getDb();
    const [inserted] = await db
      .insert(schema.emailDedupes)
      .values({
        id: newId('email_dedupe'),
        dedupeKey,
        category: input.category,
        toEmail: allRecipients[0] || '',
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: schema.emailDedupes.dedupeKey })
      .returning({ id: schema.emailDedupes.id });

    if (!inserted) {
      logDedupedEmail({
        category: input.category,
        recipients: allRecipients,
        subject,
        dedupeKey,
      });
      return {
        status: 'deduped',
        sent: false,
        blocked: true,
        deduped: true,
        category: input.category,
        mode,
        reason: 'deduped',
      } satisfies SendCategorizedEmailResult;
    }

    claimedDedupeKey = true;
  }

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    if (claimedDedupeKey && dedupeKey && transactionalCategory) {
      const dbForCleanup = db || getDb();
      await dbForCleanup.delete(schema.emailDedupes).where(eq(schema.emailDedupes.dedupeKey, dedupeKey));
    }

    return {
      status: 'failed',
      sent: false,
      blocked: false,
      category: input.category,
      mode,
      reason: 'provider_unavailable',
      providerStatus: 0,
    } satisfies SendCategorizedEmailResult;
  }

  if (!response.ok) {
    if (claimedDedupeKey && dedupeKey && transactionalCategory) {
      const dbForCleanup = db || getDb();
      await dbForCleanup.delete(schema.emailDedupes).where(eq(schema.emailDedupes.dedupeKey, dedupeKey));
    }
    return {
      status: 'failed',
      sent: false,
      blocked: false,
      category: input.category,
      mode,
      reason: response.status >= 400 && response.status < 500 ? 'provider_rejected' : 'provider_unavailable',
      providerStatus: response.status,
    } satisfies SendCategorizedEmailResult;
  }

  logSentEmail({
    category: input.category,
    recipients: allRecipients,
    subject,
    dedupeKey,
  });

  return {
    status: 'sent',
    sent: true,
    blocked: false,
    category: input.category,
    mode,
  } satisfies SendCategorizedEmailResult;
}
