import { ok } from '../../_lib/api-response.js';
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
    const contactToEmail = getEnvString('CONTACT_TO_EMAIL');
    const salesToEmail = getEnvString('SALES_TO_EMAIL');

    const fromDomain = fromEmail.includes('@') ? fromEmail.split('@')[1] : null;
    const replyToDomain = replyTo.includes('@') ? replyTo.split('@')[1] : null;

    const protocol = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
    const inferredBaseUrl = host ? `${protocol || 'https'}://${host}` : '';
    const baseUrl = getEnvString('APP_BASE_URL') || inferredBaseUrl || null;

    const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
    const configured = Boolean(resendApiKey && fromEmail);
    const hasResendKey = Boolean(resendApiKey);
    const hasContactInbox = Boolean(contactToEmail);
    const hasSalesInbox = Boolean(salesToEmail);

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
      baseUrl,
      environment,
      isValidConfig: configured,
    });
  });
}
