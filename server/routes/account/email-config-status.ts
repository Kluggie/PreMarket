import { ok } from '../../_lib/api-response.js';
import { resolveSalesInboxEmail, resolveSupportInboxEmail } from '../../_lib/email-delivery.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function getEnvString(name: string) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/email-config-status', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    if (auth.user.role !== 'admin') {
      throw new ApiError(403, 'forbidden', 'Admin access required');
    }

    const resendApiKey = getEnvString('RESEND_API_KEY');
    const fromEmail = getEnvString('RESEND_FROM_EMAIL');
    const fromName = getEnvString('RESEND_FROM_NAME');
    const replyTo = getEnvString('RESEND_REPLY_TO');
    const emailMode = getEnvString('EMAIL_MODE') || 'contact_only';
    const devEmailSink = getEnvString('DEV_EMAIL_SINK');
    const contactToEmail = resolveSupportInboxEmail();
    const salesToEmail = resolveSalesInboxEmail();

    const fromDomain = fromEmail.includes('@') ? fromEmail.split('@')[1] : null;
    const replyToDomain = replyTo.includes('@') ? replyTo.split('@')[1] : null;

    const protocol = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
    const inferredBaseUrl = host ? `${protocol || 'https'}://${host}` : '';
    const baseUrl = getEnvString('APP_BASE_URL') || inferredBaseUrl || null;

    const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
    const configured = Boolean(resendApiKey && fromEmail);
    const hasResendKey = Boolean(resendApiKey);
    const hasContactInbox = Boolean(getEnvString('SUPPORT_INBOX_EMAIL') || contactToEmail);
    const hasSalesInbox = Boolean(getEnvString('SALES_INBOX_EMAIL') || salesToEmail);
    const normalizedMode = ['contact_only', 'transactional', 'disabled'].includes(emailMode)
      ? emailMode
      : 'contact_only';
    const allowedEmailCategories =
      normalizedMode === 'disabled'
        ? []
        : normalizedMode === 'contact_only'
          ? ['contact_support', 'contact_sales']
          : [
              'contact_support',
              'contact_sales',
              'proposal_received',
              'evaluation_complete',
              'proposal_reevaluation_complete',
              'mutual_interest',
              'shared_link_activity',
              'account_verification',
            ];

    ok(res, 200, {
      configured,
      hasResendKey,
      fromEmail: fromEmail || null,
      fromName: fromName || null,
      fromDomain: fromDomain || null,
      replyTo: replyTo || null,
      replyToDomain: replyToDomain || null,
      hasContactInbox,
      hasSalesInbox,
      contactToEmail: contactToEmail || null,
      salesToEmail: salesToEmail || null,
      emailMode: normalizedMode,
      allowedEmailCategories,
      devEmailSink: devEmailSink || null,
      baseUrl,
      environment,
      isValidConfig: configured,
    });
  });
}
