import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { getResendConfig } from '../../_lib/integrations.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function trySendNotificationEmail(input: {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  apiKey: string;
  requesterName: string;
  requesterEmail: string;
  message: string;
}) {
  const to = input.replyTo || input.fromEmail;
  const from = input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail;

  const text = [
    'New custom template request',
    '',
    `Name: ${input.requesterName}`,
    `Email: ${input.requesterEmail}`,
    '',
    'Message:',
    input.message,
  ].join('\n');

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject: `Custom template request from ${input.requesterName}`,
    text,
    reply_to: input.requesterEmail,
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return response.ok;
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/contact-requests', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const name = asText(body.name || auth.user.name || auth.user.full_name || '');
    const email = asText(body.email || auth.user.email || '');
    const message = asText(body.message || body.details || '');

    if (!name) {
      throw new ApiError(400, 'invalid_input', 'Name is required');
    }

    if (!email || !isLikelyEmail(email)) {
      throw new ApiError(400, 'invalid_input', 'A valid email is required');
    }

    if (!message) {
      throw new ApiError(400, 'invalid_input', 'Message is required');
    }

    const resend = getResendConfig();
    const db = getDb();
    const now = new Date();
    const requestId = newId('contact_request');

    let emailAttempted = false;
    let emailSent = false;

    if (resend.ready) {
      emailAttempted = true;
      try {
        emailSent = await trySendNotificationEmail({
          fromName: resend.fromName,
          fromEmail: resend.fromEmail,
          replyTo: resend.replyTo,
          apiKey: resend.apiKey,
          requesterName: name,
          requesterEmail: email,
          message,
        });
      } catch {
        emailSent = false;
      }
    }

    await db.insert(schema.contactRequests).values({
      id: requestId,
      userId: auth.user.id,
      name,
      email,
      reason: 'request',
      type: 'general',
      status: 'new',
      message,
      emailAttempted,
      emailSent,
      metadata: {
        source: 'templates_custom_request',
      },
      createdAt: now,
      updatedAt: now,
    });

    const [saved] = await db
      .select({
        id: schema.contactRequests.id,
      })
      .from(schema.contactRequests)
      .where(and(eq(schema.contactRequests.id, requestId), eq(schema.contactRequests.userId, auth.user.id)))
      .limit(1);

    ok(res, 201, {
      request: {
        id: saved?.id || requestId,
        status: 'new',
      },
      delivery: emailSent ? 'email' : 'db',
    });
  });
}
