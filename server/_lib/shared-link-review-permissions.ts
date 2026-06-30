function toObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function readRecipientAiReviewValue(source: Record<string, unknown>) {
  const directKeys = [
    'allow_recipient_extra_ai_review',
    'allowRecipientExtraAiReview',
    'recipient_extra_ai_review_enabled',
    'recipientExtraAiReviewEnabled',
    'allow_recipient_ai_review',
    'allowRecipientAiReview',
    'recipient_ai_reviews_enabled',
    'recipientAiReviewsEnabled',
  ];
  for (const key of directKeys) {
    const parsed = parseBooleanLike(source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

export function getRecipientAiReviewEnabled(source: unknown) {
  const candidate = toObject(source);
  const direct = readRecipientAiReviewValue(candidate);
  if (direct !== null) {
    return direct;
  }

  const reportMetadata = toObject((candidate as any).reportMetadata || (candidate as any).report_metadata);
  return readRecipientAiReviewValue(reportMetadata) ?? false;
}

export const getRecipientExtraAiReviewEnabled = getRecipientAiReviewEnabled;

export function mergeRecipientAiReviewIntoReportMetadata(
  reportMetadata: unknown,
  enabled: boolean,
) {
  return {
    ...toObject(reportMetadata),
    allow_recipient_ai_review: Boolean(enabled),
  };
}

export const mergeRecipientExtraAiReviewIntoReportMetadata = mergeRecipientAiReviewIntoReportMetadata;

export function readRecipientAiReviewEnabledFromBody(
  body: Record<string, unknown>,
  fallback = false,
) {
  const parsed = readRecipientAiReviewValue(toObject(body));
  return parsed ?? fallback;
}

export const readRecipientExtraAiReviewEnabledFromBody = readRecipientAiReviewEnabledFromBody;
